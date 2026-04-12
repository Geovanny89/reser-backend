const sequelize = require('../config/database');

const User         = require('./User')(sequelize);
const Business     = require('./Business')(sequelize);
const BusinessType = require('./BusinessType')(sequelize);
const Service    = require('./Service')(sequelize);
const Employee   = require('./Employee')(sequelize);
const Appointment = require('./Appointment')(sequelize);
const Schedule   = require('./Schedule')(sequelize);
const ClientDevice = require('./ClientDevice')(sequelize);
const WhatsAppSession = require('./WhatsAppSession')(sequelize);
const SystemSetting = require('./SystemSetting')(sequelize);
const Promotion     = require('./Promotion')(sequelize);

// Business — User (owner)
Business.belongsTo(User, { foreignKey: 'ownerId', as: 'Owner' });
User.hasMany(Business, { foreignKey: 'ownerId', as: 'Businesses' });

// Branch System
Business.belongsTo(Business, { foreignKey: 'parentBusinessId', as: 'ParentBusiness' });
Business.hasMany(Business, { foreignKey: 'parentBusinessId', as: 'Branches' });

// Promotion — Business & Service
Promotion.belongsTo(Business, { foreignKey: 'businessId' });
Business.hasMany(Promotion,   { foreignKey: 'businessId', as: 'Promotions' });
Promotion.belongsTo(Service,  { foreignKey: 'serviceId' });
Service.hasMany(Promotion,    { foreignKey: 'serviceId', as: 'Promotions' });

// Business — WhatsAppSession
WhatsAppSession.belongsTo(Business, { foreignKey: 'businessId' });
Business.hasOne(WhatsAppSession, { foreignKey: 'businessId', as: 'WhatsAppSession' });

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
Appointment.belongsTo(Promotion, { foreignKey: 'promotionId' });
Business.hasMany(Appointment,    { foreignKey: 'businessId' });
Employee.hasMany(Appointment,    { foreignKey: 'employeeId' });

// Schedule — Employee
Schedule.belongsTo(Employee, { foreignKey: 'employeeId' });
Employee.hasMany(Schedule, { foreignKey: 'employeeId', as: 'Schedules' });

module.exports = { sequelize, User, Business, BusinessType, Service, Employee, Appointment, Schedule, ClientDevice, WhatsAppSession, SystemSetting, Promotion };
