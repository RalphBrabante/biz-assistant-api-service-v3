const express = require('express');
const {
  createRole,
  listRoles,
  getRoleById,
  updateRole,
  deleteRole,
} = require('../controllers/roles-controller');
const { authorize } = require('../middleware/authz');

const router = express.Router();

router.post('/', authorize('roles.manage'), createRole);
router.get('/', authorize('roles.manage'), listRoles);
router.get('/:id', authorize('roles.manage'), getRoleById);
router.put('/:id', authorize('roles.manage'), updateRole);
router.patch('/:id', authorize('roles.manage'), updateRole);
router.delete('/:id', authorize('roles.manage'), deleteRole);

module.exports = router;
