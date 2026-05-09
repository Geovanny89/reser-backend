const users = require('./users');
const impersonation = require('./impersonation');
const activity = require('./activity');
const reports = require('./reports');

module.exports = {
  ...users,
  ...impersonation,
  ...activity,
  ...reports
};
