# -*- coding: utf-8 -*-
{
    "name": """POS Product Info Description""",
    'version': '0.1.1',
    'category': 'Point of Sale',
    'sequence': 12,
    'author':  'Luis Miguel Varón E',
    'website': 'https://www.tacticaweb.com.co',
    'summary': 'Product Extend Info on POS',
    'description': """
POS Product Info.
Add Product Sale Description to Product Info Pop Up
""",
    'depends': [
        'point_of_sale',
        ],
    'assets': {
        'point_of_sale.assets': [
            'pos_product_info/static/src/js/models.js',
            ],
        'web.assets_qweb': [
            'pos_product_info/static/src/xml/pos_tip_suggest.xml'
        ]
    },
    'installable': True,
    'auto_install': False,
    'application': True,
}
