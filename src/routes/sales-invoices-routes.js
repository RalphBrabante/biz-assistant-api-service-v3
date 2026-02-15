const express = require('express');
const {
  createSalesInvoice,
  listSalesInvoices,
  getSalesInvoiceById,
  updateSalesInvoice,
  deleteSalesInvoice,
} = require('../controllers/sales-invoices-controller');
const { authorize } = require('../middleware/authz');

const router = express.Router();

router.post('/', authorize('sales_invoices.create'), createSalesInvoice);
router.get('/', authorize('sales_invoices.read'), listSalesInvoices);
router.get('/:id', authorize('sales_invoices.read'), getSalesInvoiceById);
router.put('/:id', authorize('sales_invoices.update'), updateSalesInvoice);
router.patch('/:id', authorize('sales_invoices.update'), updateSalesInvoice);
router.delete('/:id', authorize('sales_invoices.update'), deleteSalesInvoice);

module.exports = router;
