const { SystemSetting } = require('../models');

exports.getSetting = async (req, res) => {
  try {
    const { key } = req.params;
    const setting = await SystemSetting.findOne({ where: { key } });
    res.json(setting || { key, value: '', isActive: false });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

exports.updateSetting = async (req, res) => {
  try {
    const { key } = req.params;
    const { value, isActive } = req.body;
    
    const [setting] = await SystemSetting.findOrCreate({ 
      where: { key },
      defaults: { key, value: '', isActive: false }
    });
    
    await setting.update({ value, isActive });
    res.json(setting);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

exports.getGlobalNotification = async (req, res) => {
  try {
    const setting = await SystemSetting.findOne({ where: { key: 'global_notification' } });
    if (setting && setting.isActive) {
      return res.json({ message: setting.value });
    }
    res.json({ message: null });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
