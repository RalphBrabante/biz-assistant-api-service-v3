const express = require('express');
const {
  createUser,
  listUsers,
  getUserById,
  updateUser,
  deleteUser,
} = require('../controllers/users-controller');
const { authorize } = require('../middleware/authz');

const router = express.Router();

router.post('/', authorize('users.create'), createUser);
router.get('/', authorize('users.read'), listUsers);
router.get('/:id', authorize('users.read'), getUserById);
router.put('/:id', authorize('users.update'), updateUser);
router.patch('/:id', authorize('users.update'), updateUser);
router.delete('/:id', authorize('users.delete'), deleteUser);

module.exports = router;
