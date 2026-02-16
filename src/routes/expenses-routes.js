const express = require('express');
const {
  createExpense,
  importExpenses,
  exportExpenses,
  listExpenses,
  getExpenseById,
  updateExpense,
  deleteExpense,
} = require('../controllers/expenses-controller');
const { authorize } = require('../middleware/authz');
const { uploadExpenseImage, uploadImportCsv } = require('../middleware/upload');

const router = express.Router();

router.post('/', authorize('expenses.create'), uploadExpenseImage, createExpense);
router.post('/import', authorize('expenses.create'), uploadImportCsv, importExpenses);
router.get('/export', authorize('expenses.read'), exportExpenses);
router.get('/', authorize('expenses.read'), listExpenses);
router.get('/:id', authorize('expenses.read'), getExpenseById);
router.put('/:id', authorize('expenses.update'), uploadExpenseImage, updateExpense);
router.patch('/:id', authorize('expenses.update'), uploadExpenseImage, updateExpense);
router.delete('/:id', authorize('expenses.update'), deleteExpense);

module.exports = router;
