const { Op } = require('sequelize');
const { getModels } = require('../sequelize');

function getItemModels() {
  const models = getModels();
  if (!models || !models.Item || !models.Organization) {
    return null;
  }
  return {
    Item: models.Item,
    Organization: models.Organization,
  };
}

function pickItemPayload(body = {}) {
  return {
    organizationId: body.organizationId,
    type: body.type,
    sku: body.sku,
    name: body.name,
    description: body.description,
    category: body.category,
    unit: body.unit,
    price: body.price,
    discountedPrice: body.discountedPrice,
    currency: body.currency,
    stock: body.stock,
    reorderLevel: body.reorderLevel,
    taxRate: body.taxRate,
    isActive: body.isActive,
    createdBy: body.createdBy,
    updatedBy: body.updatedBy,
  };
}

function cleanUndefined(payload) {
  return Object.fromEntries(
    Object.entries(payload).filter(([, value]) => value !== undefined)
  );
}

function parseBoolean(value) {
  if (value === true || value === 'true' || value === 1 || value === '1') {
    return true;
  }
  if (value === false || value === 'false' || value === 0 || value === '0') {
    return false;
  }
  return undefined;
}

async function createItem(req, res) {
  try {
    const models = getItemModels();
    if (!models) {
      return res.status(503).json({ ok: false, message: 'Database models are not ready yet.' });
    }
    const { Item } = models;

    const payload = cleanUndefined(pickItemPayload(req.body));

    if (!payload.organizationId) {
      return res.status(400).json({ ok: false, message: 'organizationId is required.' });
    }
    if (!payload.name) {
      return res.status(400).json({ ok: false, message: 'name is required.' });
    }

    const item = await Item.create(payload);
    const created = await Item.findByPk(item.id, {
      include: [
        {
          association: 'organization',
          attributes: ['id', 'name', 'legalName'],
          required: false,
        },
      ],
    });
    return res.status(201).json({ ok: true, data: created || item });
  } catch (err) {
    console.error('Create item error:', err);
    return res.status(500).json({ ok: false, message: 'Unable to create item.' });
  }
}

async function listItems(req, res) {
  try {
    const models = getItemModels();
    if (!models) {
      return res.status(503).json({ ok: false, message: 'Database models are not ready yet.' });
    }
    const { Item } = models;

    const page = Math.max(parseInt(req.query.page || '1', 10), 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit || '20', 10), 1), 100);
    const offset = (page - 1) * limit;

    const where = {};

    if (req.query.organizationId) {
      where.organizationId = req.query.organizationId;
    }
    if (req.query.type) {
      where.type = req.query.type;
    }
    const isActive = parseBoolean(req.query.isActive);
    if (isActive !== undefined) {
      where.isActive = isActive;
    }
    if (req.query.q) {
      where[Op.or] = [
        { name: { [Op.like]: `%${req.query.q}%` } },
        { sku: { [Op.like]: `%${req.query.q}%` } },
        { category: { [Op.like]: `%${req.query.q}%` } },
      ];
    }

    const { rows, count } = await Item.findAndCountAll({
      where,
      include: [
        {
          association: 'organization',
          attributes: ['id', 'name', 'legalName'],
          required: false,
        },
      ],
      limit,
      offset,
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
    console.error('List items error:', err);
    return res.status(500).json({ ok: false, message: 'Unable to fetch items.' });
  }
}

async function getItemById(req, res) {
  try {
    const models = getItemModels();
    if (!models) {
      return res.status(503).json({ ok: false, message: 'Database models are not ready yet.' });
    }
    const { Item } = models;

    const item = await Item.findByPk(req.params.id, {
      include: [
        {
          association: 'organization',
          attributes: ['id', 'name', 'legalName'],
          required: false,
        },
      ],
    });
    if (!item) {
      return res.status(404).json({ ok: false, message: 'Item not found.' });
    }

    return res.status(200).json({ ok: true, data: item });
  } catch (err) {
    console.error('Get item error:', err);
    return res.status(500).json({ ok: false, message: 'Unable to fetch item.' });
  }
}

async function updateItem(req, res) {
  try {
    const models = getItemModels();
    if (!models) {
      return res.status(503).json({ ok: false, message: 'Database models are not ready yet.' });
    }
    const { Item } = models;

    const item = await Item.findByPk(req.params.id);
    if (!item) {
      return res.status(404).json({ ok: false, message: 'Item not found.' });
    }

    const payload = cleanUndefined(pickItemPayload(req.body));
    if (Object.keys(payload).length === 0) {
      return res.status(400).json({ ok: false, message: 'No valid fields provided for update.' });
    }

    await item.update(payload);
    const updated = await Item.findByPk(item.id, {
      include: [
        {
          association: 'organization',
          attributes: ['id', 'name', 'legalName'],
          required: false,
        },
      ],
    });
    return res.status(200).json({ ok: true, data: updated || item });
  } catch (err) {
    console.error('Update item error:', err);
    return res.status(500).json({ ok: false, message: 'Unable to update item.' });
  }
}

async function deleteItem(req, res) {
  try {
    const models = getItemModels();
    if (!models) {
      return res.status(503).json({ ok: false, message: 'Database models are not ready yet.' });
    }
    const { Item } = models;

    const item = await Item.findByPk(req.params.id);
    if (!item) {
      return res.status(404).json({ ok: false, message: 'Item not found.' });
    }

    await item.destroy();
    return res.status(200).json({ ok: true, message: 'Item deleted successfully.' });
  } catch (err) {
    console.error('Delete item error:', err);
    return res.status(500).json({ ok: false, message: 'Unable to delete item.' });
  }
}

module.exports = {
  createItem,
  listItems,
  getItemById,
  updateItem,
  deleteItem,
};
