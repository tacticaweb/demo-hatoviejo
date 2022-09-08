odoo.define('sync_pos_combo_product.models', function (require) {
    "use strict";

    const models = require('point_of_sale.models');

    models.load_fields("product.product", ["is_combo"]);

    models.load_models({
        model: 'product.combo',
        fields: ['product_template_id', 'is_required_product', 'is_include_in_main_product_price', 'category_id', 'product_ids', 'no_of_items'],
        loaded: function (self, combo) {
            self.combo = combo;
            self.combo_products_by_id = {};
            for (let i = 0; i < combo.length; i++) {
                self.combo_products_by_id[combo[i].id] = combo[i];
            }
        },
    });

    let _super_order = models.Order.prototype;
    models.Order = models.Order.extend({
        initialize: function () {
            let res = _super_order.initialize.apply(this, arguments);
            return this;
        },
        manage_combo_products_selected: function(checked_req_dom, checked_un_req_dom) {
            let self = this;
            let product_ids_req = [];
            let product_ids_unreq = [];
            let product_attribute_ids = {};
            let product_attributes_values = [];
            let order = self.pos.get_order();
            let orderline = order.get_selected_orderline();
            product_ids_req = _.map(checked_req_dom, function(value){
                return $(value).attr('id');
            });
            product_ids_unreq = _.map(checked_un_req_dom, function(value){
                return $(value).attr('id');
            });
            _.each(checked_req_dom, function(value) {
                let full_name = self.pos.db.get_product_by_id(Number($(value).attr('id').split('id')[0])).display_name;
                if($(value).attr('attributes')) {
                    product_attribute_ids[$(value).attr('id').split('id')[0]] = {'attributes': $(value).attr('attributes'), 'full_name_product': full_name += ` (${$(value).attr('attributes')})`}
                } else {
                    product_attribute_ids[$(value).attr('id').split('id')[0]] = {'attributes': $(value).attr('attributes'), 'full_name_product': full_name}
                }
            });
            _.each(checked_un_req_dom, function(value) {
                let full_name = self.pos.db.get_product_by_id(Number($(value).attr('id').split('id')[0])).display_name;
                if($(value).attr('attributes')) {
                    product_attribute_ids[$(value).attr('id').split('id')[0]] = {'attributes': $(value).attr('attributes'), 'full_name_product': full_name += ` (${$(value).attr('attributes')})`}
                } else {
                    product_attribute_ids[$(value).attr('id').split('id')[0]] = {'attributes': $(value).attr('attributes'), 'full_name_product': full_name}
                }
            });
            product_attributes_values.push(product_attribute_ids);
            orderline.set_combo_product_attributes(product_attributes_values);
            orderline.set_require_product(_.map(product_ids_req, function(value){
                return Number(value.split('id')[0]);
            }));
            orderline.set_unrequire_product(_.map(product_ids_unreq, function(value){
                return Number(value.split('id')[0]);
            }));
            orderline.set_all_sub_product_selected_id(_.union(product_ids_req, product_ids_unreq));
            orderline.set_select_combo_id(
                _.uniq(_.union(_.map(product_ids_req, function(value){return Number(value.split('id')[1])}), 
                    _.map(product_ids_unreq, function(value){return Number(value.split('id')[1])})
                )));
        },
        get_product_data: function(category, product_temp_id) {
            // Filter combo product data as a category wise
            let self = this;
            let result = {};
            let result_required = {};
            let result_unrequired = {};
            _.each(self.pos.combo_products_by_id, function(value) {
                if(!_.isEmpty(value.product_template_id) && category && value.product_template_id[0] === product_temp_id && category == value.category_id[0]) {
                    if (value.is_required_product) {
                        result_required = {
                            'no_of_items': value.no_of_items,
                            'is_require': value.is_required_product,
                            'req_products_ids': value.product_ids,
                            'combo_id': value.id,
                        }
                    }
                    else {
                        result_unrequired = {
                            'no_of_items': value.no_of_items,
                            'is_require': value.is_required_product,
                            'unreq_products_ids': value.product_ids,
                            'combo_id': value.id,
                        }
                    }
                }
                result = {
                    'req_product': result_required,
                    'unreq_product': result_unrequired,
                    'category_id': self.pos.db.get_category_by_id(category),
                }
            });
            return result;
        },
        set_pricelist: function (pricelist) {
            let self = this;
            this.pricelist = pricelist;
            let lines_to_recompute = _.filter(this.get_orderlines(), function (line) {
                if (line.is_combo_line === true) {
                    return !line.price_manually_set || line.is_combo_line;
                }
                return !line.price_manually_set;
            });
            _.each(lines_to_recompute, function (line) {
                if (line && line.is_combo_line) {
                    let combo_price = line.get_combo_price();
                    line.set_unit_price(combo_price.full_combo_price);
                } else {
                    line.set_unit_price(line.product.get_price(self.pricelist, line.get_quantity()));
                    self.fix_tax_included_price(line);
                }
            });
            this.trigger('change');
        },

        // POS restaurant method for add combo product in kitchen order
        build_line_resume: function() {
            let self = this;
            let resume = {};
            this.orderlines.each(function(line){
                if (line.mp_skip) {
                    return;
                }
                let line_hash = line.get_line_diff_hash();
                let line_resume = self.get_line_resume(line);

                if (typeof resume[line_hash] === 'undefined') {
                    resume[line_hash] = line_resume;
                } else {
                    resume[line_hash].qty += line_resume.qty;
                }
            });
            return resume;
        },
        get_line_resume: function(line) {
            let self = this;
            let qty  = Number(line.get_quantity());
            let note = line.get_note();
            let product_id = line.get_product().id;
            let product_name_wrapped = line.generate_wrapped_product_name();
            let req_product_ids = _.map(line.req_product, function(id){return self.pos.db.get_product_by_id(id)}) || false;
            let unreq_product_ids = _.map(line.unreq_product, function(id){return self.pos.db.get_product_by_id(id)}) || false;
            let is_combo_line = line.is_combo_line || false;
            let product_attributes_values = line.get_combo_product_attributes() || false;
            return {product_attributes_values: product_attributes_values, qty: qty, note: note, product_id: product_id, product_name_wrapped: product_name_wrapped, req_product_ids: req_product_ids, unreq_product_ids:unreq_product_ids, is_combo_line:is_combo_line};
        },
        computeChanges: function(categories){
            let res = _super_order.computeChanges.apply(this, arguments);
            let current_res = this.build_line_resume();
            let old_res = this.saved_resume || {};
            let json = this.export_as_JSON();
            let add = [];
            let rem = [];
            let line_hash;
            res.new = [];
            for (line_hash in current_res) {
                let curr = current_res[line_hash];
                let old  = {};
                let found = false;
                for(let id in old_res) {
                    if(old_res[id].product_id === curr.product_id){
                        found = true;
                        old = old_res[id];
                        break;
                    }
                }
                if (!found) {
                    add.push({
                        'id':       curr.product_id,
                        'name':     this.pos.db.get_product_by_id(curr.product_id).display_name,
                        'name_wrapped': curr.product_name_wrapped,
                        'note':     curr.note,
                        'req_product_ids': curr.req_product_ids || false,
                        'unreq_product_ids': curr.unreq_product_ids || false,
                        'product_attributes_values': curr.product_attributes_values || false,
                        'is_combo_line': curr.is_combo_line || false,
                    });
                } else if (old.qty < curr.qty) {
                    add.push({
                        'id':       curr.product_id,
                        'name':     this.pos.db.get_product_by_id(curr.product_id).display_name,
                        'name_wrapped': curr.product_name_wrapped,
                        'note':     curr.note,
                        'req_product_ids': curr.req_product_ids || false,
                        'unreq_product_ids': curr.unreq_product_ids || false,
                        'product_attributes_values': curr.product_attributes_values || false,
                        'is_combo_line': curr.is_combo_line || false,
                    });
                } else if (old.qty > curr.qty) {
                    rem.push({
                        'id':       curr.product_id,
                        'name':     this.pos.db.get_product_by_id(curr.product_id).display_name,
                        'name_wrapped': curr.product_name_wrapped,
                        'note':     curr.note,
                        'req_product_ids': curr.req_product_ids || false,
                        'unreq_product_ids': curr.unreq_product_ids || false,
                        'product_attributes_values': curr.product_attributes_values || false,
                        'is_combo_line': curr.is_combo_line || false,
                    });
                }
            }
            for (line_hash in old_res) {
                let found = false;
                for(let id in current_res) {
                    if(current_res[id].product_id === old_res[line_hash].product_id)
                        found = true;
                }
                if (!found) {
                    let old = old_res[line_hash];
                    rem.push({
                        'id':       old.product_id,
                        'name':     this.pos.db.get_product_by_id(old.product_id).display_name,
                        'name_wrapped': old.product_name_wrapped,
                        'note':     old.note,
                        'req_product_ids': old.req_product_ids || false,
                        'unreq_product_ids': old.unreq_product_ids || false,
                        'product_attributes_values': old.product_attributes_values || false,
                        'is_combo_line': old.is_combo_line || false,
                    });
                }
            }
            if(categories && categories.length > 0){
            // filter the added and removed orders to only contains
            // products that belong to one of the categories supplied as a parameter

                let self = this;

                let _add = [];
                let _rem = [];

                for(let i = 0; i < add.length; i++){
                    if(self.pos.db.is_product_in_category(categories,add[i].id)){
                        _add.push(add[i]);
                    }
                }
                add = _add;

                for(let i = 0; i < rem.length; i++){
                    if(self.pos.db.is_product_in_category(categories,rem[i].id)){
                        _rem.push(rem[i]);
                    }
                }
                rem = _rem;
            }
            let d = new Date();
            let hours   = '' + d.getHours();
                hours   = hours.length < 2 ? ('0' + hours) : hours;
            let minutes = '' + d.getMinutes();
                minutes = minutes.length < 2 ? ('0' + minutes) : minutes;

            res.new = add;
            res.cancelled = rem;
            res.table = json.table || false;
            res.floor = json.floor || false;
            res.time = {
                'hours':   hours,
                'minutes': minutes,
            }

            return res;
        },
    });

    let _super_orderline = models.Orderline.prototype;
    models.Orderline = models.Orderline.extend({
        initialize: function(attr, options) {
            _super_orderline.initialize.call(this,attr,options);
            this.unreq_product = this.unreq_product || [];
            this.select_combo_id = this.select_combo_id || [];
            this.req_product = this.req_product || [];
            this.extra_price = this.extra_price || 0.0;
            this.edit_product = this.edit_product || [];
            this.all_selected_product_id = this.all_selected_product_id || [];
            this.qty = this.get_quantity();
            this.is_combo_line = this.is_combo_line || false;
            this.final_combo_price = this.final_combo_price || 0.0;
            this.combo_product_attribute_values = this.combo_product_attribute_values || [];
            this.sub_product_line = this.sub_product_line || false;
            this.unreq_product_without_draft = this.unreq_product_without_draft || [];
            this.req_product_ids_without_draft = this.req_product_ids_without_draft || [];
        },
        set_combo_product_attributes: function(product_configurator) {
            this.combo_product_attribute_values = product_configurator;
        },
        get_combo_product_attributes: function() {
            return this.combo_product_attribute_values;
        },
        set_unrequire_product: function(unreq_product) {
            this.unreq_product = unreq_product;
            this.unreq_product_without_draft = unreq_product;
            this.is_combo_line = true;
        },
        get_unrequire_product: function() {
            return this.unreq_product;
        },
        set_final_combo_price: function(final_combo_price) {
            this.final_combo_price = final_combo_price;
        },
        get_final_combo_price: function() {
            return this.final_combo_price;
        },
        set_extra_price_combo: function(extra_price) {
            this.extra_price = extra_price;
            this.get_combo_price();
            this.trigger('change');
        },
        get_extra_price_combo: function() {
            return this.extra_price;
        },
        set_all_sub_product_selected_id: function(all_selected_product_id) {
            this.all_selected_product_id = all_selected_product_id;
        },
        get_all_sub_product_selected_id: function() {
            return this.all_selected_product_id;
        },
        get_combo_price: function() {
            let self = this;
            let list_product_price = [];
            let combo_amount_dict = {};
            if (this.is_combo_line) {
                _.each(_.map(this.get_unrequire_product(), function(id){return self.pos.db.get_product_by_id(id)}), function(value){
                    list_product_price.push(value.get_price(self.order.pricelist, self.get_quantity()))
                })
                let combo_data = _.map(self.select_combo_id, function(id){return self.pos.combo_products_by_id[id]});
                _.each(combo_data, function(comboData){
                    if(comboData && comboData.is_required_product && !comboData.is_include_in_main_product_price) {
                        let req_product_ids = _.intersection(comboData.product_ids, self.get_require_product());
                        if(!_.isEmpty(req_product_ids)) {
                            _.each(req_product_ids, function(product_id){
                                list_product_price.push(self.pos.db.get_product_by_id(product_id).get_price(self.order.pricelist, self.get_quantity()));
                            });
                        }
                    }
                });
                let combo_price = _.reduce(list_product_price, function(price, number) {
                    return price + number;
                }, 0);
                let total_price = self.qty * combo_price;
                let product_price = self.product.get_price(self.order.pricelist, self.get_quantity());
                let final_price = product_price * this.qty + total_price;
                combo_amount_dict = {
                    'total_additional_amount': total_price,
                    'main_product_price': product_price,
                    'full_combo_price': final_price,
                }
                self.set_final_combo_price(final_price);
                return combo_amount_dict;
            }
        },
        set_require_product: function(req_product) {
            this.req_product = req_product;
            this.req_product_ids_without_draft = req_product;
            this.is_combo_line = true;
        },
        get_require_product: function() {
            return this.req_product;
        },
        set_select_combo_id: function(select_combo_id) {
            this.select_combo_id = select_combo_id;
            this.trigger('change',this);
        },
        get_select_combo_id: function() {
            return this.select_combo_id;
        },
        can_be_merged_with: function(orderline){
            let res = _super_orderline.can_be_merged_with.call(this, orderline);
            if (this.is_combo_line) {
                return false;
            }
            return res;
        },
        set_edit_combo_id: function(edit_product){
            this.edit_product = edit_product;
        },
        get_edit_combo_id: function(edit_product){
            return this.edit_product;
        },
        get_line_diff_hash: function(){
            let res = _super_orderline.get_line_diff_hash.apply(this, arguments);
            if(this.is_combo_line){
                return this.id + '|' + _.map(this.unreq_product, 'id') + '|' + _.map(this.req_product, 'id');
            }
            return res;
        },
        clone: function(){
            let orderline = _super_orderline.clone.call(this);
            orderline.req_product = this.req_product;
            return orderline;
        },
        init_from_JSON: function (json) {
            _super_orderline.init_from_JSON.apply(this, arguments);
            let self = this;
            if (self.pos.config.module_pos_restaurant) {
                var unreq_ids = [];
                var req_ids = [];
                this.req_product_ids_without_draft = json.req_product_ids_without_draft;
                this.unreq_product_without_draft = json.unreq_product_without_draft;
                if (!_.isEmpty(this.req_product_ids_without_draft)) {
                    this.req_product = this.req_product_ids_without_draft;
                } else {
                    _.each(json.req_product_ids, function(product_id) {
                        if(!_.isUndefined(product_id)){
                            var req_product = self.pos.db.get_product_by_id(Number(product_id));
                            req_ids.push(product_id);
                        }
                    });
                    this.req_product = req_ids;
                }
                if (!_.isEmpty(this.unreq_product_without_draft)) {
                    this.unreq_product = this.unreq_product_without_draft;
                } else {
                    _.each(json.unreq_product_ids, function(product_id) {
                        var unreq_product = self.pos.db.get_product_by_id(Number(product_id));
                        unreq_ids.push(product_id);
                    });
                    this.unreq_product = unreq_ids;
                }
                this.is_combo_line = json.is_combo_line;
                this.select_combo_id = json.select_combo_id;
                this.extra_price = json.extra_price || 0.0;
                this.price_manually_set = json.is_combo_line && true || false;
                this.edit_product = json.edit_combo_id || [];
                this.all_selected_product_id = json.all_selected_product_id || [];
                this.combo_product_attribute_values = json.combo_product_attribute_values || [];
                this.final_combo_price = json.final_combo_price || 0.0;
                if (this.is_combo_line) {
                    this.set_unit_price(this.final_combo_price);
                }
            } else {
                this.unreq_product = json.unreq_product_ids;
                this.is_combo_line = json.is_combo_line;
                this.select_combo_id = json.select_combo_id;
                this.req_product = json.req_product_ids;
                this.extra_price = json.extra_price || 0.0;
                this.price_manually_set = json.is_combo_line && true || false;
                this.all_selected_product_id = json.all_selected_product_id || [];
                this.combo_product_attribute_values = json.combo_product_attribute_values || [];
            }
        },
        export_as_JSON: function() {
            var self = this;
            let json = _super_orderline.export_as_JSON.call(this);
            if (self.pos.config.module_pos_restaurant) {
                json.req_product = this.req_product || false;
                var req_ids = [];
                var unreq_ids = [];
                if (!_.isEmpty(this.req_product_ids_without_draft)) {
                    json.req_product_ids = this.req_product_ids_without_draft;
                } else {
                    _.each(this.req_product, function(product_id) {
                        if(!_.isUndefined(product_id)){
                            var req_product = self.pos.db.get_product_by_id(Number(product_id));
                            req_ids.push(req_product.id);
                        }
                    });
                    json.req_product_ids = req_ids;
                }
                if (!_.isEmpty(this.unreq_product_without_draft)) {
                    json.unreq_product_ids = this.unreq_product_without_draft;
                } else {
                    _.each(this.unreq_product, function(product_id) {
                        if(!_.isUndefined(product_id)){
                            var unreq_product = self.pos.db.get_product_by_id(Number(product_id));
                            unreq_ids.push(unreq_product.id);
                        }
                    });
                    json.unreq_product_ids = unreq_ids;
                }
                json.is_combo_line = this.is_combo_line;
                json.select_combo_id = _.uniq(this.select_combo_id) || false;
                json.edit_combo_id = this.get_edit_combo_id() || false;
                json.extra_price = this.extra_price || 0.0;
                json.all_selected_product_id = this.all_selected_product_id || [];
                json.final_combo_price = this.final_combo_price || 0.0;
                json.combo_product_attribute_values = this.combo_product_attribute_values || []
            } else {
                json.req_product = this.req_product || false;
                json.unreq_product_ids = this.unreq_product || false;
                json.req_product_ids = this.req_product || false;
                json.is_combo_line = this.is_combo_line;
                json.select_combo_id = this.select_combo_id || false;
                json.extra_price = this.extra_price || 0.0;
                json.all_selected_product_id = this.all_selected_product_id || [];
                json.combo_product_attribute_values = this.combo_product_attribute_values || []
            }
            return json;
        },
        export_for_printing: function() {
            var receipt = _super_orderline.export_for_printing.call(this);
            let self = this;
            receipt.req_product = this.get_require_product()
            receipt.unreq_product = this.get_unrequire_product()
            receipt.req_product = _.map(this.get_require_product(), function(id){return self.pos.db.get_product_by_id(id)});
            receipt.unreq_product = _.map(this.get_unrequire_product(), function(id){return self.pos.db.get_product_by_id(id)});
            receipt.is_combo_line = this.is_combo_line;
            receipt.combo_price = this.get_combo_price();
            receipt.select_combo_id = this.get_select_combo_id();
            receipt.combo_product_attribute_values = this.get_combo_product_attributes();
            return receipt;
        },
    });
});
