const { DataTypes, Model } = require('sequelize');

class TaxType extends Model {}

function initTaxTypeModel(sequelize) {
  TaxType.init(
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      code: {
        type: DataTypes.STRING(30),
        allowNull: false,
        unique: true,
      },
      name: {
        type: DataTypes.STRING(150),
        allowNull: false,
      },
      description: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      percentage: {
        type: DataTypes.DECIMAL(5, 2),
        allowNull: false,
        defaultValue: 0.0,
      },
      isActive: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
    },
    {
      sequelize,
      modelName: 'TaxType',
      tableName: 'tax_types',
      timestamps: true,
      underscored: true,
      indexes: [
        { unique: true, fields: ['code'] },
        { fields: ['name'] },
        { fields: ['is_active'] },
      ],
    }
  );

  return TaxType;
}

module.exports = {
  TaxType,
  initTaxTypeModel,
};
