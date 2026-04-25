/**
 * Controladores para gestión de sucursales
 */
const { Business, Employee } = require('../../models');

// POST /businesses/request-branch
exports.requestBranch = async (req, res) => {
  try {
    const { name, type, address, phone, branchPaymentScreenshot } = req.body;
    
    // Buscar el negocio principal del usuario
    let parentBiz = await Business.findOne({ 
      where: { ownerId: req.user.id },
      order: [['isBranch', 'ASC']] // Primero negocios principales
    });
    
    // Si es admin_suc, buscar el negocio principal desde su sucursal
    if (!parentBiz && req.user.role === 'admin_suc') {
      const emp = await Employee.findOne({ where: { userId: req.user.id, isManager: true } });
      if (emp) {
        const currentBiz = await Business.findByPk(emp.businessId);
        if (currentBiz.isBranch) {
          parentBiz = await Business.findByPk(currentBiz.parentBusinessId);
        } else {
          parentBiz = currentBiz;
        }
      }
    }

    if (!parentBiz) return res.status(404).json({ error: 'No tienes un negocio principal registrado' });

    const branch = await Business.create({
      name,
      type: type || 'otro',
      address,
      phone,
      ownerId: parentBiz.ownerId,
      parentBusinessId: parentBiz.id,
      isBranch: true,
      branchStatus: 'pending_approval',
      status: 'blocked',
      subscriptionStatus: parentBiz.subscriptionStatus,
      subscriptionPlan: parentBiz.subscriptionPlan,
      includedUsers: parentBiz.includedUsers,
      additionalUsers: parentBiz.additionalUsers,
      monthlyTotal: parentBiz.monthlyTotal,
      additionalUserPrice: parentBiz.additionalUserPrice,
      branchPaymentScreenshot
    });

    res.status(201).json(branch);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
};

// POST /businesses/:id/approve-branch
exports.approveBranch = async (req, res) => {
  try {
    const { id } = req.params;
    const { approve } = req.body;

    const branch = await Business.findByPk(id);
    if (!branch || !branch.isBranch) return res.status(404).json({ error: 'Sucursal no encontrada' });

    if (approve) {
      await branch.update({
        branchStatus: 'approved',
        status: 'active',
        subscriptionStatus: 'paid',
        subscriptionStartDate: new Date(),
        subscriptionEndDate: new Date(new Date().setMonth(new Date().getMonth() + 1))
      });
    } else {
      await branch.update({
        branchStatus: 'rejected',
        status: 'blocked'
      });
    }

    // Emitir evento de socket para notificar al dueño del negocio principal
    const { getIO } = require('../../services/socket');
    const io = getIO();
    if (io && branch.parentBusinessId) {
      io.to(`business:${branch.parentBusinessId}`)
        .to(`admin:${branch.parentBusinessId}`)
        .emit('branch:status_updated', {
          branchId: branch.id,
          branchStatus: branch.branchStatus,
          status: branch.status,
          approve
        });
      console.log(`📢 [Socket] Sucursal ${branch.id} ${approve ? 'aprobada' : 'rechazada'}, notificando a business:${branch.parentBusinessId}`);
    }

    res.json({ message: approve ? 'Sucursal aprobada y activada' : 'Sucursal rechazada' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
