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
const ClientTag     = require('./ClientTag')(sequelize);
const ClientTagAssignment = require('./ClientTagAssignment')(sequelize);
const BusinessReview = require('./BusinessReview')(sequelize);
const ScheduledMessage = require('./ScheduledMessage')(sequelize);
const EmployeeService = require('./EmployeeService')(sequelize);
const AppointmentNote = require('./AppointmentNote')(sequelize);
const Expense = require('./Expense')(sequelize);
const InventoryItem = require('./InventoryItem')(sequelize);
const InventoryUsage = require('./InventoryUsage')(sequelize);
const Deposit = require('./Deposit')(sequelize);
const AppointmentEmployee = require('./AppointmentEmployee')(sequelize);
const IncomingMessage = require('./IncomingMessage')(sequelize);
const ServiceGroup = require('./ServiceGroup')(sequelize);
const SpecialSchedule = require('./SpecialSchedule')(sequelize);
const ActivityLog = require('./ActivityLog')(sequelize);
const EmployeeVacation = require('./EmployeeVacation')(sequelize);
const CashRegisterShift = require('./CashRegisterShift')(sequelize);
const CashMovement = require('./CashMovement')(sequelize);
const AppointmentReminderEvent = require('./AppointmentReminderEvent')(sequelize);
const PlatformReview = require('./PlatformReview')(sequelize);
const ClientProfile = require('./ClientProfile')(sequelize);
const BirthdayTemplate = require('./BirthdayTemplate')(sequelize);

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

// ServiceGroup — Business
ServiceGroup.belongsTo(Business, { foreignKey: 'businessId' });
Business.hasMany(ServiceGroup, { foreignKey: 'businessId', as: 'ServiceGroups' });

// Service — ServiceGroup
Service.belongsTo(ServiceGroup, { foreignKey: 'serviceGroupId', as: 'Group' });
ServiceGroup.hasMany(Service, { foreignKey: 'serviceGroupId', as: 'Services' });

// Employee — Business — User
Employee.belongsTo(Business, { foreignKey: 'businessId' });
Business.hasMany(Employee, { foreignKey: 'businessId', as: 'Employees' });
Employee.belongsTo(User, { foreignKey: 'userId' });
User.hasOne(Employee, { foreignKey: 'userId', constraints: false });

// Employee — Service (Many-to-Many via EmployeeService)
Employee.belongsToMany(Service, { through: EmployeeService, foreignKey: 'employeeId', as: 'Services' });
Service.belongsToMany(Employee, { through: EmployeeService, foreignKey: 'serviceId', as: 'Employees' });
EmployeeService.belongsTo(Employee, { foreignKey: 'employeeId' });
EmployeeService.belongsTo(Service, { foreignKey: 'serviceId' });

// Appointment
Appointment.belongsTo(Business,  { foreignKey: 'businessId' });
Appointment.belongsTo(Service,   { foreignKey: 'serviceId' });
Appointment.belongsTo(Employee,  { foreignKey: 'employeeId' });
Appointment.belongsTo(User,      { foreignKey: 'clientId', as: 'Client' });
Appointment.belongsTo(Promotion, { foreignKey: 'promotionId' });
Business.hasMany(Appointment,    { foreignKey: 'businessId' });
Employee.hasMany(Appointment,    { foreignKey: 'employeeId' });

// Appointment — AppointmentNote
AppointmentNote.belongsTo(Appointment, { foreignKey: 'appointmentId' });
Appointment.hasMany(AppointmentNote, { foreignKey: 'appointmentId', as: 'Notes' });

// Schedule — Employee
Schedule.belongsTo(Employee, { foreignKey: 'employeeId' });
Employee.hasMany(Schedule, { foreignKey: 'employeeId', as: 'Schedules' });

// SpecialSchedule — Employee & Business
SpecialSchedule.belongsTo(Employee, { foreignKey: 'employeeId' });
SpecialSchedule.belongsTo(Business, { foreignKey: 'businessId' });
Employee.hasMany(SpecialSchedule, { foreignKey: 'employeeId', as: 'SpecialSchedules' });
Business.hasMany(SpecialSchedule, { foreignKey: 'businessId', as: 'SpecialSchedules' });

// EmployeeVacation — Employee & Business
EmployeeVacation.belongsTo(Employee, { foreignKey: 'employeeId' });
EmployeeVacation.belongsTo(Business, { foreignKey: 'businessId' });
Employee.hasMany(EmployeeVacation, { foreignKey: 'employeeId', as: 'Vacations' });
Business.hasMany(EmployeeVacation, { foreignKey: 'businessId', as: 'EmployeeVacations' });

// ClientTag — Business
ClientTag.belongsTo(Business, { foreignKey: 'businessId' });
Business.hasMany(ClientTag, { foreignKey: 'businessId', as: 'ClientTags' });

// ClientTagAssignment relationships
ClientTagAssignment.belongsTo(ClientTag, { foreignKey: 'clientTagId', as: 'Tag' });
ClientTag.hasMany(ClientTagAssignment, { foreignKey: 'clientTagId', as: 'Assignments' });
ClientTagAssignment.belongsTo(Business, { foreignKey: 'businessId' });

// BusinessReview — Business
BusinessReview.belongsTo(Business, { foreignKey: 'businessId' });
Business.hasMany(BusinessReview, { foreignKey: 'businessId', as: 'Reviews' });

// ScheduledMessage — Business & Appointment
ScheduledMessage.belongsTo(Business, { foreignKey: 'businessId' });
Business.hasMany(ScheduledMessage, { foreignKey: 'businessId', as: 'ScheduledMessages' });
ScheduledMessage.belongsTo(Appointment, { foreignKey: 'appointmentId' });
Appointment.hasMany(ScheduledMessage, { foreignKey: 'appointmentId', as: 'ScheduledMessages' });

// Expense — Business
Expense.belongsTo(Business, { foreignKey: 'businessId' });
Business.hasMany(Expense, { foreignKey: 'businessId', as: 'Expenses' });

// InventoryItem — Business
InventoryItem.belongsTo(Business, { foreignKey: 'businessId' });
Business.hasMany(InventoryItem, { foreignKey: 'businessId', as: 'InventoryItems' });

// InventoryUsage — Business & InventoryItem
InventoryUsage.belongsTo(Business, { foreignKey: 'businessId' });
InventoryUsage.belongsTo(InventoryItem, { foreignKey: 'itemId' });
InventoryUsage.belongsTo(Appointment, { foreignKey: 'appointmentId' });
InventoryItem.hasMany(InventoryUsage, { foreignKey: 'itemId', as: 'Usages' });

// Deposit — Business & Appointment
Deposit.belongsTo(Business, { foreignKey: 'businessId' });
Deposit.belongsTo(Appointment, { foreignKey: 'appointmentId' });
Business.hasMany(Deposit, { foreignKey: 'businessId', as: 'Deposits' });

// AppointmentEmployee — Citas con múltiples empleados
AppointmentEmployee.belongsTo(Appointment, { foreignKey: 'appointmentId' });
AppointmentEmployee.belongsTo(Employee, { foreignKey: 'employeeId' });
Appointment.hasMany(AppointmentEmployee, { foreignKey: 'appointmentId', as: 'AdditionalEmployees' });
Employee.hasMany(AppointmentEmployee, { foreignKey: 'employeeId', as: 'AppointmentsAsExtra' });

ActivityLog.belongsTo(User, { foreignKey: 'userId', as: 'User' });
User.hasMany(ActivityLog, { foreignKey: 'userId', as: 'ActivityLogs' });

// ActivityLog — Business
ActivityLog.belongsTo(Business, { foreignKey: 'businessId', as: 'Business' });
Business.hasMany(ActivityLog, { foreignKey: 'businessId', as: 'ActivityLogs' });


// CashRegisterShift — Business & Employee
CashRegisterShift.belongsTo(Business, { foreignKey: 'businessId' });
Business.hasMany(CashRegisterShift, { foreignKey: 'businessId', as: 'CashRegisterShifts' });
CashRegisterShift.belongsTo(Employee, { foreignKey: 'employeeId' });
Employee.hasMany(CashRegisterShift, { foreignKey: 'employeeId', as: 'CashRegisterShifts' });
CashRegisterShift.belongsTo(User, { foreignKey: 'createdBy', as: 'Creator' });

// CashMovement — Business, Shift, Appointment, Expense
CashMovement.belongsTo(Business, { foreignKey: 'businessId' });
Business.hasMany(CashMovement, { foreignKey: 'businessId', as: 'CashMovements' });
CashMovement.belongsTo(CashRegisterShift, { foreignKey: 'shiftId', as: 'Shift' });
CashRegisterShift.hasMany(CashMovement, { foreignKey: 'shiftId', as: 'Movements' });
CashMovement.belongsTo(Appointment, { foreignKey: 'appointmentId' });
Appointment.hasMany(CashMovement, { foreignKey: 'appointmentId', as: 'CashMovements' });
CashMovement.belongsTo(Expense, { foreignKey: 'expenseId' });
Expense.hasMany(CashMovement, { foreignKey: 'expenseId', as: 'CashMovements' });

// Auto-asociación para reversas/correcciones
CashMovement.belongsTo(CashMovement, { foreignKey: 'reversesMovementId', as: 'ReversedMovement' });
CashMovement.hasOne(CashMovement, { foreignKey: 'reversesMovementId', as: 'Reversal' });

// AppointmentReminderEvent - Appointment & Business
AppointmentReminderEvent.belongsTo(Appointment, { foreignKey: 'appointmentId' });
Appointment.hasMany(AppointmentReminderEvent, { foreignKey: 'appointmentId', as: 'ReminderEvents' });
AppointmentReminderEvent.belongsTo(Business, { foreignKey: 'businessId' });
Business.hasMany(AppointmentReminderEvent, { foreignKey: 'businessId', as: 'ReminderEvents' });

// PlatformReview — Business
PlatformReview.belongsTo(Business, { foreignKey: 'businessId', as: 'Business' });
Business.hasMany(PlatformReview, { foreignKey: 'businessId', as: 'PlatformReviews' });

// ClientProfile — Business
ClientProfile.belongsTo(Business, { foreignKey: 'businessId' });
Business.hasMany(ClientProfile, { foreignKey: 'businessId', as: 'ClientProfiles' });

// BirthdayTemplate — Business
BirthdayTemplate.belongsTo(Business, { foreignKey: 'businessId' });
Business.hasMany(BirthdayTemplate, { foreignKey: 'businessId', as: 'BirthdayTemplates' });

const { Op } = require('sequelize');

module.exports = { sequelize, Op, User, Business, BusinessType, Service, Employee, Appointment, Schedule, SpecialSchedule, ClientDevice, WhatsAppSession, SystemSetting, Promotion, ClientTag, ClientTagAssignment, BusinessReview, ScheduledMessage, EmployeeService, AppointmentNote, Expense, InventoryItem, InventoryUsage, Deposit, AppointmentEmployee, IncomingMessage, ServiceGroup, ActivityLog, EmployeeVacation, CashRegisterShift, CashMovement, AppointmentReminderEvent, PlatformReview, ClientProfile, BirthdayTemplate };
