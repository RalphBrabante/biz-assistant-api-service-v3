const { initOrganizationModel, Organization } = require('./organization');
const { initUserModel, User } = require('./user');
const { initLicenseModel, License } = require('./license');
const {
  initOrganizationUserModel,
  OrganizationUser,
} = require('./organization-user');
const {
  initInvalidLoginAttemptModel,
  InvalidLoginAttempt,
} = require('./invalid-login-attempt');
const { initTokenModel, Token } = require('./token');
const { initRoleModel, Role } = require('./role');
const { initUserRoleModel, UserRole } = require('./user-role');
const { initItemModel, Item } = require('./item');
const { initPermissionModel, Permission } = require('./permission');
const { initRolePermissionModel, RolePermission } = require('./role-permission');
const {
  initPurchaseOrderModel,
  PurchaseOrder,
} = require('./purchase-order');
const { initVendorModel, Vendor } = require('./vendor');
const { initOrderModel, Order } = require('./order');
const { initSalesInvoiceModel, SalesInvoice } = require('./sales-invoice');
const { initExpenseModel, Expense } = require('./expense');
const { initCustomerModel, Customer } = require('./customer');
const {
  initWithholdingTaxTypeModel,
  WithholdingTaxType,
} = require('./withholding-tax-type');
const { initTaxTypeModel, TaxType } = require('./tax-type');
const {
  initOrderItemSnapshotModel,
  OrderItemSnapshot,
} = require('./order-item-snapshot');
const {
  initQuarterlySalesReportModel,
  QuarterlySalesReport,
} = require('./quarterly-sales-report');
const {
  initQuarterlyExpenseReportModel,
  QuarterlyExpenseReport,
} = require('./quarterly-expense-report');
const { initAppSettingModel, AppSetting } = require('./app-setting');

function initModels(sequelize) {
  initOrganizationModel(sequelize);
  initUserModel(sequelize);
  initLicenseModel(sequelize);
  initOrganizationUserModel(sequelize);
  initInvalidLoginAttemptModel(sequelize);
  initTokenModel(sequelize);
  initRoleModel(sequelize);
  initUserRoleModel(sequelize);
  initItemModel(sequelize);
  initPermissionModel(sequelize);
  initRolePermissionModel(sequelize);
  initPurchaseOrderModel(sequelize);
  initVendorModel(sequelize);
  initOrderModel(sequelize);
  initSalesInvoiceModel(sequelize);
  initExpenseModel(sequelize);
  initCustomerModel(sequelize);
  initWithholdingTaxTypeModel(sequelize);
  initTaxTypeModel(sequelize);
  initOrderItemSnapshotModel(sequelize);
  initQuarterlySalesReportModel(sequelize);
  initQuarterlyExpenseReportModel(sequelize);
  initAppSettingModel(sequelize);

  Organization.hasMany(User, {
    foreignKey: {
      name: 'organizationId',
      allowNull: true,
    },
    onUpdate: 'CASCADE',
    onDelete: 'SET NULL',
    as: 'primaryUsers',
  });

  User.belongsTo(Organization, {
    foreignKey: {
      name: 'organizationId',
      allowNull: true,
    },
    onUpdate: 'CASCADE',
    onDelete: 'SET NULL',
    as: 'primaryOrganization',
  });

  Organization.belongsToMany(User, {
    through: OrganizationUser,
    foreignKey: 'organizationId',
    otherKey: 'userId',
    onUpdate: 'CASCADE',
    onDelete: 'CASCADE',
    as: 'users',
  });

  User.belongsToMany(Organization, {
    through: OrganizationUser,
    foreignKey: 'userId',
    otherKey: 'organizationId',
    onUpdate: 'CASCADE',
    onDelete: 'CASCADE',
    as: 'organizations',
  });

  Organization.hasMany(License, {
    foreignKey: {
      name: 'organizationId',
      allowNull: true,
    },
    onUpdate: 'CASCADE',
    onDelete: 'SET NULL',
    as: 'licenses',
  });

  License.belongsTo(Organization, {
    foreignKey: {
      name: 'organizationId',
      allowNull: true,
    },
    onUpdate: 'CASCADE',
    onDelete: 'SET NULL',
    as: 'organization',
  });

  User.hasMany(InvalidLoginAttempt, {
    foreignKey: {
      name: 'userId',
      allowNull: false,
    },
    onUpdate: 'CASCADE',
    onDelete: 'CASCADE',
    as: 'invalidLoginAttempts',
  });

  InvalidLoginAttempt.belongsTo(User, {
    foreignKey: {
      name: 'userId',
      allowNull: false,
    },
    onUpdate: 'CASCADE',
    onDelete: 'CASCADE',
    as: 'user',
  });

  User.hasMany(Token, {
    foreignKey: {
      name: 'userId',
      allowNull: false,
    },
    onUpdate: 'CASCADE',
    onDelete: 'CASCADE',
    as: 'tokens',
  });

  Token.belongsTo(User, {
    foreignKey: {
      name: 'userId',
      allowNull: false,
    },
    onUpdate: 'CASCADE',
    onDelete: 'CASCADE',
    as: 'user',
  });

  User.belongsToMany(Role, {
    through: UserRole,
    foreignKey: 'userId',
    otherKey: 'roleId',
    onUpdate: 'CASCADE',
    onDelete: 'CASCADE',
    as: 'roles',
  });

  Role.belongsToMany(User, {
    through: UserRole,
    foreignKey: 'roleId',
    otherKey: 'userId',
    onUpdate: 'CASCADE',
    onDelete: 'CASCADE',
    as: 'users',
  });

  User.hasMany(UserRole, {
    foreignKey: {
      name: 'userId',
      allowNull: false,
    },
    onUpdate: 'CASCADE',
    onDelete: 'CASCADE',
    as: 'userRoles',
  });

  UserRole.belongsTo(User, {
    foreignKey: {
      name: 'userId',
      allowNull: false,
    },
    onUpdate: 'CASCADE',
    onDelete: 'CASCADE',
    as: 'user',
  });

  Role.hasMany(UserRole, {
    foreignKey: {
      name: 'roleId',
      allowNull: false,
    },
    onUpdate: 'CASCADE',
    onDelete: 'CASCADE',
    as: 'userRoles',
  });

  UserRole.belongsTo(Role, {
    foreignKey: {
      name: 'roleId',
      allowNull: false,
    },
    onUpdate: 'CASCADE',
    onDelete: 'CASCADE',
    as: 'role',
  });

  User.hasMany(UserRole, {
    foreignKey: {
      name: 'assignedByUserId',
      allowNull: true,
    },
    onUpdate: 'CASCADE',
    onDelete: 'SET NULL',
    as: 'assignedUserRoles',
  });

  UserRole.belongsTo(User, {
    foreignKey: {
      name: 'assignedByUserId',
      allowNull: true,
    },
    onUpdate: 'CASCADE',
    onDelete: 'SET NULL',
    as: 'assignedBy',
  });

  Role.belongsToMany(Permission, {
    through: RolePermission,
    foreignKey: 'roleId',
    otherKey: 'permissionId',
    onUpdate: 'CASCADE',
    onDelete: 'CASCADE',
    as: 'permissions',
  });

  Permission.belongsToMany(Role, {
    through: RolePermission,
    foreignKey: 'permissionId',
    otherKey: 'roleId',
    onUpdate: 'CASCADE',
    onDelete: 'CASCADE',
    as: 'roles',
  });

  Role.hasMany(RolePermission, {
    foreignKey: {
      name: 'roleId',
      allowNull: false,
    },
    onUpdate: 'CASCADE',
    onDelete: 'CASCADE',
    as: 'rolePermissions',
  });

  RolePermission.belongsTo(Role, {
    foreignKey: {
      name: 'roleId',
      allowNull: false,
    },
    onUpdate: 'CASCADE',
    onDelete: 'CASCADE',
    as: 'role',
  });

  Permission.hasMany(RolePermission, {
    foreignKey: {
      name: 'permissionId',
      allowNull: false,
    },
    onUpdate: 'CASCADE',
    onDelete: 'CASCADE',
    as: 'rolePermissions',
  });

  RolePermission.belongsTo(Permission, {
    foreignKey: {
      name: 'permissionId',
      allowNull: false,
    },
    onUpdate: 'CASCADE',
    onDelete: 'CASCADE',
    as: 'permission',
  });

  User.hasMany(RolePermission, {
    foreignKey: {
      name: 'assignedByUserId',
      allowNull: true,
    },
    onUpdate: 'CASCADE',
    onDelete: 'SET NULL',
    as: 'assignedRolePermissions',
  });

  RolePermission.belongsTo(User, {
    foreignKey: {
      name: 'assignedByUserId',
      allowNull: true,
    },
    onUpdate: 'CASCADE',
    onDelete: 'SET NULL',
    as: 'assignedBy',
  });

  Organization.hasMany(Item, {
    foreignKey: {
      name: 'organizationId',
      allowNull: false,
    },
    onUpdate: 'CASCADE',
    onDelete: 'CASCADE',
    as: 'items',
  });

  Item.belongsTo(Organization, {
    foreignKey: {
      name: 'organizationId',
      allowNull: false,
    },
    onUpdate: 'CASCADE',
    onDelete: 'CASCADE',
    as: 'organization',
  });

  User.hasMany(Item, {
    foreignKey: {
      name: 'createdBy',
      allowNull: true,
    },
    onUpdate: 'CASCADE',
    onDelete: 'SET NULL',
    as: 'createdItems',
  });

  Item.belongsTo(User, {
    foreignKey: {
      name: 'createdBy',
      allowNull: true,
    },
    onUpdate: 'CASCADE',
    onDelete: 'SET NULL',
    as: 'creator',
  });

  User.hasMany(Item, {
    foreignKey: {
      name: 'updatedBy',
      allowNull: true,
    },
    onUpdate: 'CASCADE',
    onDelete: 'SET NULL',
    as: 'updatedItems',
  });

  Item.belongsTo(User, {
    foreignKey: {
      name: 'updatedBy',
      allowNull: true,
    },
    onUpdate: 'CASCADE',
    onDelete: 'SET NULL',
    as: 'updater',
  });

  Organization.hasMany(PurchaseOrder, {
    foreignKey: {
      name: 'organizationId',
      allowNull: false,
    },
    onUpdate: 'CASCADE',
    onDelete: 'CASCADE',
    as: 'purchaseOrders',
  });

  PurchaseOrder.belongsTo(Organization, {
    foreignKey: {
      name: 'organizationId',
      allowNull: false,
    },
    onUpdate: 'CASCADE',
    onDelete: 'CASCADE',
    as: 'organization',
  });

  User.hasMany(PurchaseOrder, {
    foreignKey: {
      name: 'createdBy',
      allowNull: true,
    },
    onUpdate: 'CASCADE',
    onDelete: 'SET NULL',
    as: 'createdPurchaseOrders',
  });

  PurchaseOrder.belongsTo(User, {
    foreignKey: {
      name: 'createdBy',
      allowNull: true,
    },
    onUpdate: 'CASCADE',
    onDelete: 'SET NULL',
    as: 'creator',
  });

  User.hasMany(PurchaseOrder, {
    foreignKey: {
      name: 'updatedBy',
      allowNull: true,
    },
    onUpdate: 'CASCADE',
    onDelete: 'SET NULL',
    as: 'updatedPurchaseOrders',
  });

  PurchaseOrder.belongsTo(User, {
    foreignKey: {
      name: 'updatedBy',
      allowNull: true,
    },
    onUpdate: 'CASCADE',
    onDelete: 'SET NULL',
    as: 'updater',
  });

  User.hasMany(PurchaseOrder, {
    foreignKey: {
      name: 'approvedBy',
      allowNull: true,
    },
    onUpdate: 'CASCADE',
    onDelete: 'SET NULL',
    as: 'approvedPurchaseOrders',
  });

  PurchaseOrder.belongsTo(User, {
    foreignKey: {
      name: 'approvedBy',
      allowNull: true,
    },
    onUpdate: 'CASCADE',
    onDelete: 'SET NULL',
    as: 'approver',
  });

  Organization.hasMany(Vendor, {
    foreignKey: {
      name: 'organizationId',
      allowNull: false,
    },
    onUpdate: 'CASCADE',
    onDelete: 'CASCADE',
    as: 'vendors',
  });

  Vendor.belongsTo(Organization, {
    foreignKey: {
      name: 'organizationId',
      allowNull: false,
    },
    onUpdate: 'CASCADE',
    onDelete: 'CASCADE',
    as: 'organization',
  });

  User.hasMany(Vendor, {
    foreignKey: {
      name: 'createdBy',
      allowNull: true,
    },
    onUpdate: 'CASCADE',
    onDelete: 'SET NULL',
    as: 'createdVendors',
  });

  Vendor.belongsTo(User, {
    foreignKey: {
      name: 'createdBy',
      allowNull: true,
    },
    onUpdate: 'CASCADE',
    onDelete: 'SET NULL',
    as: 'creator',
  });

  User.hasMany(Vendor, {
    foreignKey: {
      name: 'updatedBy',
      allowNull: true,
    },
    onUpdate: 'CASCADE',
    onDelete: 'SET NULL',
    as: 'updatedVendors',
  });

  Vendor.belongsTo(User, {
    foreignKey: {
      name: 'updatedBy',
      allowNull: true,
    },
    onUpdate: 'CASCADE',
    onDelete: 'SET NULL',
    as: 'updater',
  });

  Organization.hasMany(Order, {
    foreignKey: {
      name: 'organizationId',
      allowNull: false,
    },
    onUpdate: 'CASCADE',
    onDelete: 'CASCADE',
    as: 'orders',
  });

  Order.belongsTo(Organization, {
    foreignKey: {
      name: 'organizationId',
      allowNull: false,
    },
    onUpdate: 'CASCADE',
    onDelete: 'CASCADE',
    as: 'organization',
  });

  User.hasMany(Order, {
    foreignKey: {
      name: 'userId',
      allowNull: true,
    },
    onUpdate: 'CASCADE',
    onDelete: 'SET NULL',
    as: 'orders',
  });

  Order.belongsTo(User, {
    foreignKey: {
      name: 'userId',
      allowNull: true,
    },
    onUpdate: 'CASCADE',
    onDelete: 'SET NULL',
    as: 'user',
  });

  User.hasMany(Order, {
    foreignKey: {
      name: 'createdBy',
      allowNull: true,
    },
    onUpdate: 'CASCADE',
    onDelete: 'SET NULL',
    as: 'createdOrders',
  });

  Order.belongsTo(User, {
    foreignKey: {
      name: 'createdBy',
      allowNull: true,
    },
    onUpdate: 'CASCADE',
    onDelete: 'SET NULL',
    as: 'creator',
  });

  User.hasMany(Order, {
    foreignKey: {
      name: 'updatedBy',
      allowNull: true,
    },
    onUpdate: 'CASCADE',
    onDelete: 'SET NULL',
    as: 'updatedOrders',
  });

  Order.belongsTo(User, {
    foreignKey: {
      name: 'updatedBy',
      allowNull: true,
    },
    onUpdate: 'CASCADE',
    onDelete: 'SET NULL',
    as: 'updater',
  });

  Customer.hasMany(Order, {
    foreignKey: {
      name: 'customerId',
      allowNull: true,
    },
    onUpdate: 'CASCADE',
    onDelete: 'SET NULL',
    as: 'orders',
  });

  Order.belongsTo(Customer, {
    foreignKey: {
      name: 'customerId',
      allowNull: true,
    },
    onUpdate: 'CASCADE',
    onDelete: 'SET NULL',
    as: 'customer',
  });

  Order.hasMany(OrderItemSnapshot, {
    foreignKey: {
      name: 'orderId',
      allowNull: false,
    },
    onUpdate: 'CASCADE',
    onDelete: 'CASCADE',
    as: 'orderedItemSnapshots',
  });

  OrderItemSnapshot.belongsTo(Order, {
    foreignKey: {
      name: 'orderId',
      allowNull: false,
    },
    onUpdate: 'CASCADE',
    onDelete: 'CASCADE',
    as: 'order',
  });

  Item.hasMany(OrderItemSnapshot, {
    foreignKey: {
      name: 'itemId',
      allowNull: true,
    },
    onUpdate: 'CASCADE',
    onDelete: 'SET NULL',
    as: 'orderItemSnapshots',
  });

  OrderItemSnapshot.belongsTo(Item, {
    foreignKey: {
      name: 'itemId',
      allowNull: true,
    },
    onUpdate: 'CASCADE',
    onDelete: 'SET NULL',
    as: 'item',
  });

  Organization.hasMany(SalesInvoice, {
    foreignKey: {
      name: 'organizationId',
      allowNull: false,
    },
    onUpdate: 'CASCADE',
    onDelete: 'CASCADE',
    as: 'salesInvoices',
  });

  SalesInvoice.belongsTo(Organization, {
    foreignKey: {
      name: 'organizationId',
      allowNull: false,
    },
    onUpdate: 'CASCADE',
    onDelete: 'CASCADE',
    as: 'organization',
  });

  Order.hasOne(SalesInvoice, {
    foreignKey: {
      name: 'orderId',
      allowNull: false,
    },
    onUpdate: 'CASCADE',
    onDelete: 'CASCADE',
    as: 'salesInvoice',
  });

  SalesInvoice.belongsTo(Order, {
    foreignKey: {
      name: 'orderId',
      allowNull: false,
    },
    onUpdate: 'CASCADE',
    onDelete: 'CASCADE',
    as: 'order',
  });

  User.hasMany(SalesInvoice, {
    foreignKey: {
      name: 'createdBy',
      allowNull: true,
    },
    onUpdate: 'CASCADE',
    onDelete: 'SET NULL',
    as: 'createdSalesInvoices',
  });

  SalesInvoice.belongsTo(User, {
    foreignKey: {
      name: 'createdBy',
      allowNull: true,
    },
    onUpdate: 'CASCADE',
    onDelete: 'SET NULL',
    as: 'creator',
  });

  User.hasMany(SalesInvoice, {
    foreignKey: {
      name: 'updatedBy',
      allowNull: true,
    },
    onUpdate: 'CASCADE',
    onDelete: 'SET NULL',
    as: 'updatedSalesInvoices',
  });

  SalesInvoice.belongsTo(User, {
    foreignKey: {
      name: 'updatedBy',
      allowNull: true,
    },
    onUpdate: 'CASCADE',
    onDelete: 'SET NULL',
    as: 'updater',
  });

  Organization.hasMany(Expense, {
    foreignKey: {
      name: 'organizationId',
      allowNull: false,
    },
    onUpdate: 'CASCADE',
    onDelete: 'CASCADE',
    as: 'expenses',
  });

  Expense.belongsTo(Organization, {
    foreignKey: {
      name: 'organizationId',
      allowNull: false,
    },
    onUpdate: 'CASCADE',
    onDelete: 'CASCADE',
    as: 'organization',
  });

  Vendor.hasMany(Expense, {
    foreignKey: {
      name: 'vendorId',
      allowNull: false,
    },
    onUpdate: 'CASCADE',
    onDelete: 'RESTRICT',
    as: 'expenses',
  });

  Expense.belongsTo(Vendor, {
    foreignKey: {
      name: 'vendorId',
      allowNull: false,
    },
    onUpdate: 'CASCADE',
    onDelete: 'RESTRICT',
    as: 'vendor',
  });

  TaxType.hasMany(Expense, {
    foreignKey: {
      name: 'taxTypeId',
      allowNull: true,
    },
    onUpdate: 'CASCADE',
    onDelete: 'SET NULL',
    as: 'expenses',
  });

  Expense.belongsTo(TaxType, {
    foreignKey: {
      name: 'taxTypeId',
      allowNull: true,
    },
    onUpdate: 'CASCADE',
    onDelete: 'SET NULL',
    as: 'taxType',
  });

  TaxType.hasMany(Organization, {
    foreignKey: {
      name: 'taxTypeId',
      allowNull: true,
    },
    onUpdate: 'CASCADE',
    onDelete: 'RESTRICT',
    as: 'organizations',
  });

  Organization.belongsTo(TaxType, {
    foreignKey: {
      name: 'taxTypeId',
      allowNull: true,
    },
    onUpdate: 'CASCADE',
    onDelete: 'RESTRICT',
    as: 'taxType',
  });

  User.hasMany(Expense, {
    foreignKey: {
      name: 'approvedBy',
      allowNull: true,
    },
    onUpdate: 'CASCADE',
    onDelete: 'SET NULL',
    as: 'approvedExpenses',
  });

  Expense.belongsTo(User, {
    foreignKey: {
      name: 'approvedBy',
      allowNull: true,
    },
    onUpdate: 'CASCADE',
    onDelete: 'SET NULL',
    as: 'approver',
  });

  Organization.hasMany(Customer, {
    foreignKey: {
      name: 'organizationId',
      allowNull: false,
    },
    onUpdate: 'CASCADE',
    onDelete: 'CASCADE',
    as: 'customers',
  });

  Customer.belongsTo(Organization, {
    foreignKey: {
      name: 'organizationId',
      allowNull: false,
    },
    onUpdate: 'CASCADE',
    onDelete: 'CASCADE',
    as: 'organization',
  });

  User.hasMany(Customer, {
    foreignKey: {
      name: 'createdBy',
      allowNull: true,
    },
    onUpdate: 'CASCADE',
    onDelete: 'SET NULL',
    as: 'createdCustomers',
  });

  Customer.belongsTo(User, {
    foreignKey: {
      name: 'createdBy',
      allowNull: true,
    },
    onUpdate: 'CASCADE',
    onDelete: 'SET NULL',
    as: 'creator',
  });

  User.hasMany(Customer, {
    foreignKey: {
      name: 'updatedBy',
      allowNull: true,
    },
    onUpdate: 'CASCADE',
    onDelete: 'SET NULL',
    as: 'updatedCustomers',
  });

  Customer.belongsTo(User, {
    foreignKey: {
      name: 'updatedBy',
      allowNull: true,
    },
    onUpdate: 'CASCADE',
    onDelete: 'SET NULL',
    as: 'updater',
  });

  User.hasMany(Expense, {
    foreignKey: {
      name: 'createdBy',
      allowNull: true,
    },
    onUpdate: 'CASCADE',
    onDelete: 'SET NULL',
    as: 'createdExpenses',
  });

  Expense.belongsTo(User, {
    foreignKey: {
      name: 'createdBy',
      allowNull: true,
    },
    onUpdate: 'CASCADE',
    onDelete: 'SET NULL',
    as: 'creator',
  });

  User.hasMany(Expense, {
    foreignKey: {
      name: 'updatedBy',
      allowNull: true,
    },
    onUpdate: 'CASCADE',
    onDelete: 'SET NULL',
    as: 'updatedExpenses',
  });

  Expense.belongsTo(User, {
    foreignKey: {
      name: 'updatedBy',
      allowNull: true,
    },
    onUpdate: 'CASCADE',
    onDelete: 'SET NULL',
    as: 'updater',
  });

  Organization.hasMany(WithholdingTaxType, {
    foreignKey: {
      name: 'organizationId',
      allowNull: false,
    },
    onUpdate: 'CASCADE',
    onDelete: 'CASCADE',
    as: 'withholdingTaxTypes',
  });

  WithholdingTaxType.belongsTo(Organization, {
    foreignKey: {
      name: 'organizationId',
      allowNull: false,
    },
    onUpdate: 'CASCADE',
    onDelete: 'CASCADE',
    as: 'organization',
  });

  User.hasMany(WithholdingTaxType, {
    foreignKey: {
      name: 'createdBy',
      allowNull: true,
    },
    onUpdate: 'CASCADE',
    onDelete: 'SET NULL',
    as: 'createdWithholdingTaxTypes',
  });

  WithholdingTaxType.belongsTo(User, {
    foreignKey: {
      name: 'createdBy',
      allowNull: true,
    },
    onUpdate: 'CASCADE',
    onDelete: 'SET NULL',
    as: 'creator',
  });

  User.hasMany(WithholdingTaxType, {
    foreignKey: {
      name: 'updatedBy',
      allowNull: true,
    },
    onUpdate: 'CASCADE',
    onDelete: 'SET NULL',
    as: 'updatedWithholdingTaxTypes',
  });

  WithholdingTaxType.belongsTo(User, {
    foreignKey: {
      name: 'updatedBy',
      allowNull: true,
    },
    onUpdate: 'CASCADE',
    onDelete: 'SET NULL',
    as: 'updater',
  });

  WithholdingTaxType.hasMany(Expense, {
    foreignKey: {
      name: 'withholdingTaxTypeId',
      allowNull: true,
    },
    onUpdate: 'CASCADE',
    onDelete: 'SET NULL',
    as: 'expenses',
  });

  Expense.belongsTo(WithholdingTaxType, {
    foreignKey: {
      name: 'withholdingTaxTypeId',
      allowNull: true,
    },
    onUpdate: 'CASCADE',
    onDelete: 'SET NULL',
    as: 'withholdingTaxType',
  });

  Organization.hasMany(QuarterlySalesReport, {
    foreignKey: {
      name: 'organizationId',
      allowNull: false,
    },
    onUpdate: 'CASCADE',
    onDelete: 'CASCADE',
    as: 'quarterlySalesReports',
  });

  QuarterlySalesReport.belongsTo(Organization, {
    foreignKey: {
      name: 'organizationId',
      allowNull: false,
    },
    onUpdate: 'CASCADE',
    onDelete: 'CASCADE',
    as: 'organization',
  });

  User.hasMany(QuarterlySalesReport, {
    foreignKey: {
      name: 'generatedBy',
      allowNull: true,
    },
    onUpdate: 'CASCADE',
    onDelete: 'SET NULL',
    as: 'generatedQuarterlySalesReports',
  });

  QuarterlySalesReport.belongsTo(User, {
    foreignKey: {
      name: 'generatedBy',
      allowNull: true,
    },
    onUpdate: 'CASCADE',
    onDelete: 'SET NULL',
    as: 'generatedByUser',
  });

  Organization.hasMany(QuarterlyExpenseReport, {
    foreignKey: {
      name: 'organizationId',
      allowNull: false,
    },
    onUpdate: 'CASCADE',
    onDelete: 'CASCADE',
    as: 'quarterlyExpenseReports',
  });

  QuarterlyExpenseReport.belongsTo(Organization, {
    foreignKey: {
      name: 'organizationId',
      allowNull: false,
    },
    onUpdate: 'CASCADE',
    onDelete: 'CASCADE',
    as: 'organization',
  });

  User.hasMany(QuarterlyExpenseReport, {
    foreignKey: {
      name: 'generatedBy',
      allowNull: true,
    },
    onUpdate: 'CASCADE',
    onDelete: 'SET NULL',
    as: 'generatedQuarterlyExpenseReports',
  });

  QuarterlyExpenseReport.belongsTo(User, {
    foreignKey: {
      name: 'generatedBy',
      allowNull: true,
    },
    onUpdate: 'CASCADE',
    onDelete: 'SET NULL',
    as: 'generatedByUser',
  });

  User.hasMany(AppSetting, {
    foreignKey: {
      name: 'updatedBy',
      allowNull: true,
    },
    onUpdate: 'CASCADE',
    onDelete: 'SET NULL',
    as: 'updatedAppSettings',
  });

  AppSetting.belongsTo(User, {
    foreignKey: {
      name: 'updatedBy',
      allowNull: true,
    },
    onUpdate: 'CASCADE',
    onDelete: 'SET NULL',
    as: 'updatedByUser',
  });

  return {
    Organization,
    User,
    License,
    OrganizationUser,
    InvalidLoginAttempt,
    Token,
    Role,
    UserRole,
    Item,
    Permission,
    RolePermission,
    PurchaseOrder,
    Vendor,
    Order,
    SalesInvoice,
    Expense,
    Customer,
    WithholdingTaxType,
    TaxType,
    OrderItemSnapshot,
    QuarterlySalesReport,
    QuarterlyExpenseReport,
    AppSetting,
  };
}

module.exports = {
  initModels,
};
