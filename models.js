// models.js
const { DataTypes } = require('sequelize');
const { sequelize } = require('./db');

// User model with validation
const User = sequelize.define('User', {
    username: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true,
        validate: {
            len: [3, 20], // Username must be between 3 and 20 characters
        },
    },
    password: {
        type: DataTypes.STRING,
        allowNull: false,
        validate: {
            len: [8, 100], // Password must be at least 8 characters
        },
    },
    role: {
        type: DataTypes.STRING,
        defaultValue: 'user', // Default role
    },
});

// Role model
const Role = sequelize.define('Role', {
    name: {
        type: DataTypes.STRING,
        unique: true,
    },
});

// Relationship between User and Role
User.belongsTo(Role, { foreignKey: 'roleId' });
Role.hasMany(User, { foreignKey: 'roleId' });

module.exports = { User, Role };
