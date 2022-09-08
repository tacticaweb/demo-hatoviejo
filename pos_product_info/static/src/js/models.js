odoo.define('pos_product_info.models', function (require) {
    "use strict";

    const { Gui } = require('point_of_sale.Gui');
    var models = require('point_of_sale.models');

    models.load_fields("product.product", ["description_sale"]);    
})
