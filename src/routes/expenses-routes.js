const express = require('express');
const {
  createExpense,
  listExpenses,
  getExpenseById,
  updateExpense,
  deleteExpense,
} = require('../controllers/expenses-controller');
const { authorize } = require('../middleware/authz');

const router = express.Router();

router.post('/', authorize('expenses.create'), createExpense);
router.get('/', authorize('expenses.read'), listExpenses);
router.get('/:id', authorize('expenses.read'), getExpenseById);
router.put('/:id', authorize('expenses.update'), updateExpense);
router.patch('/:id', authorize('expenses.update'), updateExpense);
router.delete('/:id', authorize('expenses.update'), deleteExpense);

module.exports = router;
