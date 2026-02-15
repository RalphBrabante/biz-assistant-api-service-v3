const express = require('express');
const {
  computeQuarterlySalesInvoiceReport,
  listQuarterlySalesReports,
  getQuarterlySalesReportById,
  computeQuarterlyExpenseReport,
  listQuarterlyExpenseReports,
  getQuarterlyExpenseReportById,
} = require('../controllers/reports-controller');
const { authorize } = require('../middleware/authz');

const router = express.Router();

router.post('/quarterly-sales', authorize('reports.read'), computeQuarterlySalesInvoiceReport);
router.get('/quarterly-sales', authorize('reports.read'), listQuarterlySalesReports);
router.get('/quarterly-sales/:id', authorize('reports.read'), getQuarterlySalesReportById);
router.post('/quarterly-expenses', authorize('reports.read'), computeQuarterlyExpenseReport);
router.get('/quarterly-expenses', authorize('reports.read'), listQuarterlyExpenseReports);
router.get('/quarterly-expenses/:id', authorize('reports.read'), getQuarterlyExpenseReportById);

module.exports = router;
