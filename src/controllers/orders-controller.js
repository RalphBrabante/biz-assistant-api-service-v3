const { Op } = require('sequelize');
const { getModels } = require('../sequelize');

function getOrderModel() {
  const models = getModels();
  if (!models || !models.Order) {
    return null;
  }
  return models.Order;
}

function pickOrderPayload(body = {}) {
  return {
    organizationId: body.organizationId,
    orderNumber: body.orderNumber,
    userId: body.userId,
    customerId: body.customerId,
    source: body.source,
    status: body.status,
    paymentStatus: body.paymentStatus,
    fulfillmentStatus: body.fulfillmentStatus,
    orderDate: body.orderDate,
    dueDate: body.dueDate,
    currency: body.currency,
    subtotalAmount: body.subtotalAmount,
    taxAmount: body.taxAmount,
    discountAmount: body.discountAmount,
    shippingAmount: body.shippingAmount,
    totalAmount: body.totalAmount,
    billingAddress: body.billingAddress,
    shippingAddress: body.shippingAddress,
    notes: body.notes,
    paidAt: body.paidAt,
    createdBy: body.createdBy,
    updatedBy: body.updatedBy,
  };
}

function cleanUndefined(payload) {
  return Object.fromEntries(
    Object.entries(payload).filter(([, value]) => value !== undefined)
  );
}

function normalizeNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function toFixed2(value) {
  return Number(normalizeNumber(value).toFixed(2));
}

function toFixed3(value) {
  return Number(normalizeNumber(value).toFixed(3));
}

function buildSnapshotFromItem(item, orderedItem = {}) {
  const quantity = toFixed3(orderedItem.quantity || 1);
  const unitPrice = toFixed2(item.price);
  const discountedUnitPrice =
    item.discountedPrice === null || item.discountedPrice === undefined
      ? null
      : toFixed2(item.discountedPrice);
  const effectiveUnitPrice =
    discountedUnitPrice !== null ? discountedUnitPrice : unitPrice;
  const taxRate = toFixed2(item.taxRate || 0);
  const lineSubtotal = toFixed2(unitPrice * quantity);
  const lineDiscount = toFixed2((unitPrice - effectiveUnitPrice) * quantity);
  const lineTax = toFixed2((effectiveUnitPrice * quantity * taxRate) / 100);
  const lineTotal = toFixed2(effectiveUnitPrice * quantity + lineTax);

  return {
    itemId: item.id,
    sku: item.sku || null,
    name: item.name,
    description: item.description || null,
    type: item.type,
    unit: item.unit,
    currency: item.currency,
    unitPrice,
    discountedUnitPrice,
    taxRate,
    quantity,
    lineSubtotal,
    lineDiscount,
    lineTax,
    lineTotal,
    metadata: orderedItem.metadata || null,
  };
}

function buildStockDemand(entries = [], itemById = new Map()) {
  const demandByItemId = new Map();

  for (const entry of entries) {
    const item = itemById.get(entry.itemId);
    if (!item) {
      continue;
    }

    if (item.type !== 'product') {
      continue;
    }

    const quantity = toFixed3(entry.quantity || 1);
    demandByItemId.set(item.id, toFixed3((demandByItemId.get(item.id) || 0) + quantity));
  }

  return demandByItemId;
}

function ensureStockAvailable(itemById = new Map(), demandByItemId = new Map()) {
  for (const [itemId, quantity] of demandByItemId.entries()) {
    const item = itemById.get(itemId);
    if (!item) {
      throw new Error('Item was not found while validating stock.');
    }

    const availableStock = Number(item.stock ?? 0);
    if (quantity > availableStock) {
      throw new Error(`Requested quantity for item ${item.name} exceeds available stock (${availableStock}).`);
    }
  }
}

async function applyStockDeduction(itemById = new Map(), demandByItemId = new Map(), transaction) {
  for (const [itemId, quantity] of demandByItemId.entries()) {
    const item = itemById.get(itemId);
    if (!item) {
      continue;
    }

    const availableStock = Number(item.stock ?? 0);
    const nextStock = availableStock - Number(quantity);
    if (nextStock < 0) {
      throw new Error(`Requested quantity for item ${item.name} exceeds available stock (${availableStock}).`);
    }

    await item.update({ stock: Math.floor(nextStock) }, { transaction });
  }
}

function isStockValidationError(err) {
  return (
    Boolean(err?.message) &&
    String(err.message).toLowerCase().includes('exceeds available stock')
  );
}

async function createOrder(req, res) {
  try {
    const models = getModels();
    if (!models || !models.Order || !models.OrderItemSnapshot || !models.Item || !models.Customer) {
      return res.status(503).json({ ok: false, message: 'Database models are not ready yet.' });
    }

    const { Order, OrderItemSnapshot, Item, Customer } = models;
    const payload = cleanUndefined(pickOrderPayload(req.body));
    const orderedItems = Array.isArray(req.body.orderedItems)
      ? req.body.orderedItems
      : [];
    const authUser = req.auth?.user || null;
    const organizationId = authUser?.organizationId || null;
    const authUserId = authUser?.id || null;

    payload.organizationId = organizationId;
    payload.userId = authUserId;
    payload.createdBy = authUserId;
    payload.updatedBy = authUserId;

    if (!payload.organizationId) {
      return res.status(400).json({ ok: false, message: 'Logged in user has no organization assigned.' });
    }
    if (!payload.orderNumber) {
      return res.status(400).json({ ok: false, message: 'orderNumber is required.' });
    }
    if (!payload.customerId) {
      return res.status(400).json({ ok: false, message: 'customerId is required.' });
    }
    if (orderedItems.length === 0) {
      return res.status(400).json({ ok: false, message: 'orderedItems is required and must not be empty.' });
    }

    const itemIds = orderedItems.map((entry) => entry.itemId).filter(Boolean);
    if (itemIds.length !== orderedItems.length) {
      return res.status(400).json({ ok: false, message: 'Each ordered item must include itemId.' });
    }
    const uniqueItemIds = [...new Set(itemIds)];

    const transaction = await Order.sequelize.transaction();

    try {
      const customer = await Customer.findOne({
        where: {
          id: payload.customerId,
          organizationId: payload.organizationId,
          isActive: true,
        },
        transaction,
      });
      if (!customer) {
        await transaction.rollback();
        return res.status(400).json({
          ok: false,
          message: 'Selected customer is invalid for this organization.',
        });
      }

      const items = await Item.findAll({
        where: {
          id: uniqueItemIds,
          organizationId: payload.organizationId,
        },
        transaction,
      });

      if (items.length !== uniqueItemIds.length) {
        await transaction.rollback();
        return res.status(400).json({
          ok: false,
          message: 'One or more items are invalid for this organization.',
        });
      }

      const itemById = new Map(items.map((item) => [item.id, item]));
      const snapshotRows = orderedItems.map((entry) =>
        buildSnapshotFromItem(itemById.get(entry.itemId), entry)
      );
      const stockDemand = buildStockDemand(orderedItems, itemById);
      ensureStockAvailable(itemById, stockDemand);

      const order = await Order.create(payload, { transaction });

      await OrderItemSnapshot.bulkCreate(
        snapshotRows.map((row) => ({
          ...row,
          orderId: order.id,
        })),
        { transaction }
      );

      if (payload.status === 'confirmed') {
        await applyStockDeduction(itemById, stockDemand, transaction);
      }

      await transaction.commit();

      const createdOrder = await Order.findByPk(order.id, {
        include: [
          {
            model: Customer,
            as: 'customer',
            attributes: ['id', 'name', 'taxId'],
          },
          {
            model: OrderItemSnapshot,
            as: 'orderedItemSnapshots',
          },
        ],
      });

      return res.status(201).json({ ok: true, data: createdOrder });
    } catch (txErr) {
      await transaction.rollback();
      if (isStockValidationError(txErr)) {
        return res.status(400).json({ ok: false, message: txErr.message });
      }
      throw txErr;
    }
  } catch (err) {
    console.error('Create order error:', err);
    return res.status(500).json({ ok: false, message: 'Unable to create order.' });
  }
}

async function listOrders(req, res) {
  try {
    const models = getModels();
    if (!models || !models.Order || !models.OrderItemSnapshot || !models.Customer) {
      return res.status(503).json({ ok: false, message: 'Database models are not ready yet.' });
    }
    const { Order, OrderItemSnapshot, Customer } = models;

    const page = Math.max(parseInt(req.query.page || '1', 10), 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit || '20', 10), 1), 100);
    const offset = (page - 1) * limit;

    const where = {};

    if (req.query.organizationId) where.organizationId = req.query.organizationId;
    if (req.query.userId) where.userId = req.query.userId;
    if (req.query.customerId) where.customerId = req.query.customerId;
    if (req.query.status) where.status = req.query.status;
    if (req.query.paymentStatus) where.paymentStatus = req.query.paymentStatus;
    if (req.query.fulfillmentStatus) where.fulfillmentStatus = req.query.fulfillmentStatus;
    if (req.query.source) where.source = req.query.source;

    if (req.query.q) {
      where[Op.or] = [{ orderNumber: { [Op.like]: `%${req.query.q}%` } }];
    }

    const { rows, count } = await Order.findAndCountAll({
      where,
      limit,
      offset,
      include: [
        {
          model: Customer,
          as: 'customer',
          attributes: ['id', 'name', 'taxId'],
        },
        {
          model: OrderItemSnapshot,
          as: 'orderedItemSnapshots',
        },
      ],
      order: [['createdAt', 'DESC']],
    });

    return res.status(200).json({
      ok: true,
      data: rows,
      meta: {
        page,
        limit,
        total: count,
        totalPages: Math.ceil(count / limit),
      },
    });
  } catch (err) {
    console.error('List orders error:', err);
    return res.status(500).json({ ok: false, message: 'Unable to fetch orders.' });
  }
}

async function getOrderById(req, res) {
  try {
    const models = getModels();
    if (!models || !models.Order || !models.OrderItemSnapshot || !models.Customer) {
      return res.status(503).json({ ok: false, message: 'Database models are not ready yet.' });
    }
    const { Order, OrderItemSnapshot, Customer } = models;

    const order = await Order.findByPk(req.params.id, {
      include: [
        {
          model: Customer,
          as: 'customer',
          attributes: ['id', 'name', 'taxId'],
        },
        {
          model: OrderItemSnapshot,
          as: 'orderedItemSnapshots',
        },
      ],
    });
    if (!order) {
      return res.status(404).json({ ok: false, message: 'Order not found.' });
    }

    return res.status(200).json({ ok: true, data: order });
  } catch (err) {
    console.error('Get order error:', err);
    return res.status(500).json({ ok: false, message: 'Unable to fetch order.' });
  }
}

async function updateOrder(req, res) {
  try {
    const models = getModels();
    if (
      !models ||
      !models.Order ||
      !models.Customer ||
      !models.OrderItemSnapshot ||
      !models.Item ||
      !models.SalesInvoice
    ) {
      return res.status(503).json({ ok: false, message: 'Database models are not ready yet.' });
    }
    const { Order, Customer, OrderItemSnapshot, Item, SalesInvoice } = models;

    const order = await Order.findByPk(req.params.id);
    if (!order) {
      return res.status(404).json({ ok: false, message: 'Order not found.' });
    }
    if (order.status === 'completed') {
      return res.status(400).json({
        ok: false,
        message: 'Completed orders are locked and can no longer be edited.',
      });
    }

    const payload = cleanUndefined(pickOrderPayload(req.body));
    const orderedItems = Array.isArray(req.body.orderedItems) ? req.body.orderedItems : null;

    if (payload.orderNumber !== undefined) {
      return res.status(400).json({ ok: false, message: 'orderNumber is immutable and cannot be updated.' });
    }
    if (payload.customerId) {
      const customer = await Customer.findOne({
        where: {
          id: payload.customerId,
          organizationId: order.organizationId,
        },
      });
      if (!customer) {
        return res.status(400).json({
          ok: false,
          message: 'Selected customer is invalid for this organization.',
        });
      }
    }

    const authUser = req.auth?.user || null;
    const hasFieldUpdates = Object.keys(payload).length > 0;
    const hasOrderedItemsUpdate = orderedItems !== null;
    const nextStatus = payload.status !== undefined ? payload.status : order.status;
    const isTransitioningToCompleted =
      order.status !== 'completed' &&
      nextStatus === 'completed';
    const shouldApplyStockOnConfirm =
      order.status !== 'confirmed' &&
      order.status !== 'completed' &&
      nextStatus === 'confirmed';
    const salesInvoiceId = String(req.body?.salesInvoiceId || '').trim();
    const salesInvoiceIssueDate = String(
      req.body?.salesInvoiceIssueDate || new Date().toISOString().slice(0, 10)
    ).trim();

    if (!hasFieldUpdates && !hasOrderedItemsUpdate) {
      return res.status(400).json({ ok: false, message: 'No valid fields provided for update.' });
    }
    if (isTransitioningToCompleted && !salesInvoiceId) {
      return res.status(400).json({
        ok: false,
        message: 'salesInvoiceId is required when marking order as completed.',
      });
    }
    if (
      isTransitioningToCompleted &&
      !/^\d{4}-\d{2}-\d{2}$/.test(salesInvoiceIssueDate)
    ) {
      return res.status(400).json({
        ok: false,
        message: 'salesInvoiceIssueDate must be in YYYY-MM-DD format.',
      });
    }

    const transaction = await Order.sequelize.transaction();
    try {
      if (hasFieldUpdates) {
        await order.update(payload, { transaction });
      }

      if (hasOrderedItemsUpdate) {
        if (!Array.isArray(orderedItems) || orderedItems.length === 0) {
          await transaction.rollback();
          return res.status(400).json({
            ok: false,
            message: 'orderedItems must be a non-empty array when provided.',
          });
        }

        const itemIds = orderedItems.map((entry) => entry.itemId).filter(Boolean);
        if (itemIds.length !== orderedItems.length) {
          await transaction.rollback();
          return res.status(400).json({ ok: false, message: 'Each ordered item must include itemId.' });
        }
        const uniqueItemIds = [...new Set(itemIds)];

        const items = await Item.findAll({
          where: {
            id: uniqueItemIds,
            organizationId: order.organizationId,
          },
          transaction,
        });
        if (items.length !== uniqueItemIds.length) {
          await transaction.rollback();
          return res.status(400).json({
            ok: false,
            message: 'One or more items are invalid for this organization.',
          });
        }

        const itemById = new Map(items.map((item) => [item.id, item]));
        const snapshotRows = orderedItems.map((entry) =>
          buildSnapshotFromItem(itemById.get(entry.itemId), entry)
        );
        const stockDemand = buildStockDemand(orderedItems, itemById);
        ensureStockAvailable(itemById, stockDemand);

        await OrderItemSnapshot.destroy({
          where: { orderId: order.id },
          transaction,
        });

        await OrderItemSnapshot.bulkCreate(
          snapshotRows.map((row) => ({
            ...row,
            orderId: order.id,
          })),
          { transaction }
        );

        if (shouldApplyStockOnConfirm) {
          await applyStockDeduction(itemById, stockDemand, transaction);
        }
      } else if (shouldApplyStockOnConfirm) {
        const currentSnapshots = await OrderItemSnapshot.findAll({
          where: { orderId: order.id },
          attributes: ['itemId', 'quantity'],
          transaction,
        });
        if (!currentSnapshots.length) {
          await transaction.rollback();
          return res.status(400).json({
            ok: false,
            message: 'Cannot confirm order without ordered items.',
          });
        }

        const currentEntries = currentSnapshots
          .filter((row) => row.itemId)
          .map((row) => ({
            itemId: row.itemId,
            quantity: row.quantity,
          }));
        const itemIds = [...new Set(currentEntries.map((entry) => entry.itemId))];
        const items = await Item.findAll({
          where: {
            id: itemIds,
            organizationId: order.organizationId,
          },
          transaction,
        });
        if (items.length !== itemIds.length) {
          await transaction.rollback();
          return res.status(400).json({
            ok: false,
            message: 'One or more order items are invalid for this organization.',
          });
        }

        const itemById = new Map(items.map((item) => [item.id, item]));
        const stockDemand = buildStockDemand(currentEntries, itemById);
        ensureStockAvailable(itemById, stockDemand);
        await applyStockDeduction(itemById, stockDemand, transaction);
      }

      if (isTransitioningToCompleted) {
        const existingSalesInvoice = await SalesInvoice.findOne({
          where: { orderId: order.id },
          transaction,
        });
        if (existingSalesInvoice) {
          await transaction.rollback();
          return res.status(400).json({
            ok: false,
            message: 'A sales invoice already exists for this order.',
          });
        }

        await SalesInvoice.create(
          {
            organizationId: order.organizationId,
            orderId: order.id,
            invoiceNumber: salesInvoiceId,
            issueDate: salesInvoiceIssueDate,
            dueDate: order.dueDate || null,
            status: 'issued',
            paymentStatus: order.paymentStatus || 'unpaid',
            currency: order.currency || 'USD',
            subtotalAmount: order.subtotalAmount || 0,
            taxAmount: order.taxAmount || 0,
            discountAmount: order.discountAmount || 0,
            totalAmount: order.totalAmount || 0,
            notes: order.notes || null,
            createdBy: authUser?.id || order.updatedBy || order.userId || null,
            updatedBy: authUser?.id || order.updatedBy || order.userId || null,
          },
          { transaction }
        );
      }

      await transaction.commit();

      const updatedOrder = await Order.findByPk(order.id, {
        include: [
          {
            model: Customer,
            as: 'customer',
            attributes: ['id', 'name', 'taxId'],
          },
          {
            model: OrderItemSnapshot,
            as: 'orderedItemSnapshots',
          },
        ],
      });

      return res.status(200).json({ ok: true, data: updatedOrder || order });
    } catch (txErr) {
      await transaction.rollback();
      if (isStockValidationError(txErr)) {
        return res.status(400).json({ ok: false, message: txErr.message });
      }
      if (txErr?.name === 'SequelizeUniqueConstraintError') {
        return res.status(400).json({
          ok: false,
          message: 'salesInvoiceId already exists. Please use a different sales invoice id.',
        });
      }
      throw txErr;
    }
  } catch (err) {
    console.error('Update order error:', err);
    return res.status(500).json({ ok: false, message: 'Unable to update order.' });
  }
}

async function deleteOrder(req, res) {
  try {
    const Order = getOrderModel();
    if (!Order) {
      return res.status(503).json({ ok: false, message: 'Database models are not ready yet.' });
    }

    const order = await Order.findByPk(req.params.id);
    if (!order) {
      return res.status(404).json({ ok: false, message: 'Order not found.' });
    }

    await order.destroy();
    return res.status(200).json({ ok: true, message: 'Order deleted successfully.' });
  } catch (err) {
    console.error('Delete order error:', err);
    return res.status(500).json({ ok: false, message: 'Unable to delete order.' });
  }
}

module.exports = {
  createOrder,
  listOrders,
  getOrderById,
  updateOrder,
  deleteOrder,
};
