const express = require('express');
const {
  computeQuarterlySalesInvoiceReport,
  listQuarterlySalesReports,
  getQuarterlySalesReportById,
  deleteQuarterlySalesReport,
  computeQuarterlyExpenseReport,
  listQuarterlyExpenseReports,
  getQuarterlyExpenseReportById,
  deleteQuarterlyExpenseReport,
} = require('../controllers/reports-controller');
const { authorize } = require('../middleware/authz');

const router = express.Router();

router.post('/quarterly-sales', authorize('reports.read'), computeQuarterlySalesInvoiceReport);
router.get('/quarterly-sales', authorize('reports.read'), listQuarterlySalesReports);
router.get('/quarterly-sales/:id', authorize('reports.read'), getQuarterlySalesReportById);
router.delete('/quarterly-sales/:id', authorize('reports.read'), deleteQuarterlySalesReport);
router.post('/quarterly-expenses', authorize('reports.read'), computeQuarterlyExpenseReport);
router.get('/quarterly-expenses', authorize('reports.read'), listQuarterlyExpenseReports);
router.get('/quarterly-expenses/:id', authorize('reports.read'), getQuarterlyExpenseReportById);
router.delete('/quarterly-expenses/:id', authorize('reports.read'), deleteQuarterlyExpenseReport);

module.exports = router;
