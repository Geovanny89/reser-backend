const sequelize = require('../config/database');

const User         = require('./User')(sequelize);
const Business     = require('./Business')(sequelize);
const BusinessType = require('./BusinessType')(sequelize);
const Service    = require('./Service')(sequelize);
const Employee   = require('./Employee')(sequelize);
const Appointment = require('./Appointment')(sequelize);
const Schedule   = require('./Schedule')(sequelize);

// Business — User (owner)
Business.belongsTo(User, { foreignKey: 'ownerId', as: 'Owner' });
User.hasMany(Business, { foreignKey: 'ownerId', as: 'Businesses' });

// Service — Business
Service.belongsTo(Business, { foreignKey: 'businessId' });
Business.hasMany(Service, { foreignKey: 'businessId', as: 'Services' });

// Employee — Business — User
Employee.belongsTo(Business, { foreignKey: 'businessId' });
Business.hasMany(Employee, { foreignKey: 'businessId', as: 'Employees' });
Employee.belongsTo(User, { foreignKey: 'userId' });
User.hasOne(Employee, { foreignKey: 'userId' });

// Appointment
Appointment.belongsTo(Business,  { foreignKey: 'businessId' });
Appointment.belongsTo(Service,   { foreignKey: 'serviceId' });
Appointment.belongsTo(Employee,  { foreignKey: 'employeeId' });
Appointment.belongsTo(User,      { foreignKey: 'clientId', as: 'Client' });
Business.hasMany(Appointment,    { foreignKey: 'businessId' });
Employee.hasMany(Appointment,    { foreignKey: 'employeeId' });

// Schedule — Employee
Schedule.belongsTo(Employee, { foreignKey: 'employeeId' });
Employee.hasMany(Schedule, { foreignKey: 'employeeId', as: 'Schedules' });

module.exports = { sequelize, User, Business, BusinessType, Service, Employee, Appointment, Schedule };
