const express = require('express');
const {
  computeQuarterlySalesInvoiceReport,
  listQuarterlySalesReports,
  getQuarterlySalesReportById,
  getQuarterlySalesReportPreviewById,
  deleteQuarterlySalesReport,
  computeQuarterlyExpenseReport,
  listQuarterlyExpenseReports,
  getQuarterlyExpenseReportById,
  getQuarterlyExpenseReportPreviewById,
  deleteQuarterlyExpenseReport,
} = require('../controllers/reports-controller');
const { authorize } = require('../middleware/authz');

const router = express.Router();

router.post('/quarterly-sales', authorize('reports.read'), computeQuarterlySalesInvoiceReport);
router.get('/quarterly-sales', authorize('reports.read'), listQuarterlySalesReports);
router.get('/quarterly-sales/:id', authorize('reports.read'), getQuarterlySalesReportById);
router.get('/quarterly-sales/:id/preview', authorize('reports.read'), getQuarterlySalesReportPreviewById);
router.delete('/quarterly-sales/:id', authorize('reports.read'), deleteQuarterlySalesReport);
router.post('/quarterly-expenses', authorize('reports.read'), computeQuarterlyExpenseReport);
router.get('/quarterly-expenses', authorize('reports.read'), listQuarterlyExpenseReports);
router.get('/quarterly-expenses/:id', authorize('reports.read'), getQuarterlyExpenseReportById);
router.get('/quarterly-expenses/:id/preview', authorize('reports.read'), getQuarterlyExpenseReportPreviewById);
router.delete('/quarterly-expenses/:id', authorize('reports.read'), deleteQuarterlyExpenseReport);

module.exports = router;
