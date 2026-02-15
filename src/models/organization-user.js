const { DataTypes, Model } = require('sequelize');

class OrganizationUser extends Model {}

function initOrganizationUserModel(sequelize) {
  OrganizationUser.init(
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      organizationId: {
        type: DataTypes.UUID,
        allowNull: false,
      },
      userId: {
        type: DataTypes.UUID,
        allowNull: false,
      },
      role: {
        type: DataTypes.STRING(50),
        allowNull: false,
        defaultValue: 'member',
      },
      isActive: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
    },
    {
      sequelize,
      modelName: 'OrganizationUser',
      tableName: 'organization_users',
      timestamps: true,
      underscored: true,
      indexes: [
        { fields: ['organization_id'] },
        { fields: ['user_id'] },
        { unique: true, fields: ['organization_id', 'user_id'] },
      ],
    }
  );

  return OrganizationUser;
}

module.exports = {
  OrganizationUser,
  initOrganizationUserModel,
};
