const { InventoryItem, InventoryUsage, Business, Appointment } = require('../models');
const { Op } = require('sequelize');
const ExcelJS = require('exceljs');

// Items (Insumos)
exports.getItems = async (req, res) => {
  try {
    const { businessId } = req.query;
    if (!businessId) return res.status(400).json({ error: 'businessId es requerido' });

    const items = await InventoryItem.findAll({
      where: { businessId, active: true },
      order: [['name', 'ASC']]
    });

    res.json(items);
  } catch (e) {
    console.error('[getItems] Error:', e);
    res.status(500).json({ error: e.message });
  }
};

exports.createItem = async (req, res) => {
  try {
    const { businessId, name, description, unit, currentStock, minStock, costPerUnit, supplier } = req.body;

    if (!businessId || !name || !unit) {
      return res.status(400).json({ error: 'businessId, name y unit son requeridos' });
    }

    // Verificar módulo habilitado
    const business = await Business.findByPk(businessId);
    if (!business) return res.status(404).json({ error: 'Negocio no encontrado' });
    
    const enabledModules = business.enabledModules || {};
    if (!enabledModules.inventory) {
      return res.status(403).json({ error: 'El módulo de inventario no está habilitado' });
    }

    const item = await InventoryItem.create({
      businessId,
      name,
      description,
      unit,
      currentStock: parseFloat(currentStock) || 0,
      minStock: parseFloat(minStock) || 0,
      costPerUnit: costPerUnit ? parseFloat(costPerUnit) : null,
      supplier
    });

    res.status(201).json(item);
  } catch (e) {
    console.error('[createItem] Error:', e);
    res.status(500).json({ error: e.message });
  }
};

exports.updateItem = async (req, res) => {
  try {
    const { id } = req.params;
    const item = await InventoryItem.findByPk(id);
    if (!item) return res.status(404).json({ error: 'Insumo no encontrado' });

    const updateData = { ...req.body };
    if (updateData.currentStock !== undefined) updateData.currentStock = parseFloat(updateData.currentStock);
    if (updateData.minStock !== undefined) updateData.minStock = parseFloat(updateData.minStock);
    if (updateData.costPerUnit !== undefined) updateData.costPerUnit = updateData.costPerUnit ? parseFloat(updateData.costPerUnit) : null;

    await item.update(updateData);
    res.json(item);
  } catch (e) {
    console.error('[updateItem] Error:', e);
    res.status(500).json({ error: e.message });
  }
};

exports.deleteItem = async (req, res) => {
  try {
    const { id } = req.params;
    const item = await InventoryItem.findByPk(id);
    if (!item) return res.status(404).json({ error: 'Insumo no encontrado' });

    await item.update({ active: false });
    res.json({ message: 'Insumo desactivado' });
  } catch (e) {
    console.error('[deleteItem] Error:', e);
    res.status(500).json({ error: e.message });
  }
};

// Usages (Consumos)
exports.recordUsage = async (req, res) => {
  try {
    const { businessId, itemId, appointmentId, quantity, date, notes } = req.body;

    if (!businessId || !itemId || !quantity || !date) {
      return res.status(400).json({ error: 'businessId, itemId, quantity y date son requeridos' });
    }

    const item = await InventoryItem.findByPk(itemId);
    if (!item) return res.status(404).json({ error: 'Insumo no encontrado' });

    // Verificar stock suficiente
    const qty = parseFloat(quantity);
    if (item.currentStock < qty) {
      return res.status(400).json({ error: `Stock insuficiente. Disponible: ${item.currentStock} ${item.unit}` });
    }

    // Registrar uso
    const usage = await InventoryUsage.create({
      businessId,
      itemId,
      appointmentId: appointmentId || null,
      quantity: qty,
      date,
      notes,
      usedBy: req.user?.id
    });

    // Descontar del stock
    await item.update({ currentStock: item.currentStock - qty });

    res.status(201).json(usage);
  } catch (e) {
    console.error('[recordUsage] Error:', e);
    res.status(500).json({ error: e.message });
  }
};

exports.getUsages = async (req, res) => {
  try {
    const { businessId, itemId, startDate, endDate } = req.query;
    if (!businessId) return res.status(400).json({ error: 'businessId es requerido' });

    const where = { businessId };
    if (itemId) where.itemId = itemId;
    if (startDate && endDate) where.date = { [Op.between]: [startDate, endDate] };

    const usages = await InventoryUsage.findAll({
      where,
      include: [
        { model: InventoryItem, attributes: ['name', 'unit'] },
        { model: Appointment, attributes: ['clientName', 'startTime'] }
      ],
      order: [['date', 'DESC']]
    });

    res.json(usages);
  } catch (e) {
    console.error('[getUsages] Error:', e);
    res.status(500).json({ error: e.message });
  }
};

exports.getLowStock = async (req, res) => {
  try {
    const { businessId } = req.query;
    if (!businessId) return res.status(400).json({ error: 'businessId es requerido' });

    const items = await InventoryItem.findAll({
      where: { 
        businessId, 
        active: true,
        currentStock: { [Op.lte]: sequelize.col('minStock') }
      }
    });

    res.json(items);
  } catch (e) {
    console.error('[getLowStock] Error:', e);
    res.status(500).json({ error: e.message });
  }
};

exports.updateUsage = async (req, res) => {
  try {
    const { id } = req.params;
    const { itemId, quantity, date, notes } = req.body;

    const usage = await InventoryUsage.findByPk(id);
    if (!usage) return res.status(404).json({ error: 'Consumo no encontrado' });

    const item = await InventoryItem.findByPk(usage.itemId);
    if (!item) return res.status(404).json({ error: 'Insumo no encontrado' });

    // Calcular diferencia de cantidad
    const oldQty = parseFloat(usage.quantity);
    const newQty = parseFloat(quantity);
    const diff = newQty - oldQty;

    // Verificar stock suficiente si aumenta la cantidad
    if (diff > 0 && item.currentStock < diff) {
      return res.status(400).json({ error: `Stock insuficiente. Disponible: ${item.currentStock} ${item.unit}` });
    }

    // Actualizar el consumo
    await usage.update({
      itemId: itemId || usage.itemId,
      quantity: newQty,
      date: date || usage.date,
      notes: notes !== undefined ? notes : usage.notes
    });

    // Ajustar stock: si diff > 0 (aumentó) restamos, si diff < 0 (disminuyó) sumamos
    await item.update({ currentStock: item.currentStock - diff });

    res.json(usage);
  } catch (e) {
    console.error('[updateUsage] Error:', e);
    res.status(500).json({ error: e.message });
  }
};

exports.deleteUsage = async (req, res) => {
  try {
    const { id } = req.params;

    const usage = await InventoryUsage.findByPk(id);
    if (!usage) return res.status(404).json({ error: 'Consumo no encontrado' });

    const item = await InventoryItem.findByPk(usage.itemId);
    if (item) {
      // Restaurar el stock al eliminar el consumo
      const qty = parseFloat(usage.quantity);
      await item.update({ currentStock: item.currentStock + qty });
    }

    await usage.destroy();
    res.json({ message: 'Consumo eliminado y stock restaurado' });
  } catch (e) {
    console.error('[deleteUsage] Error:', e);
    res.status(500).json({ error: e.message });
  }
};

// Importar insumos desde Excel
exports.importFromExcel = async (req, res) => {
  try {
    const { businessId } = req.body;
    
    if (!businessId) {
      return res.status(400).json({ error: 'businessId es requerido' });
    }
    
    if (!req.file) {
      return res.status(400).json({ error: 'Archivo Excel es requerido' });
    }
    
    // Verificar módulo habilitado
    const business = await Business.findByPk(businessId);
    if (!business) return res.status(404).json({ error: 'Negocio no encontrado' });
    
    const enabledModules = business.enabledModules || {};
    if (!enabledModules.inventory) {
      return res.status(403).json({ error: 'El módulo de inventario no está habilitado' });
    }
    
    // Procesar archivo Excel
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(req.file.buffer);
    
    const worksheet = workbook.getWorksheet(1);
    if (!worksheet) {
      return res.status(400).json({ error: 'El archivo Excel no tiene hojas de trabajo' });
    }
    
    const results = {
      created: 0,
      updated: 0,
      errors: [],
      total: 0
    };
    
    // Unidades válidas
    const validUnits = ['unidad', 'gramos', 'mililitros', 'metros', 'porcion'];
    
    // Obtener encabezados (primera fila)
    const headers = {};
    worksheet.getRow(1).eachCell((cell, colNumber) => {
      const header = cell.value?.toString().toLowerCase().trim();
      if (header) {
        headers[header] = colNumber;
      }
    });
    
    // Mapeo de columnas posibles
    const colMap = {
      nombre: headers['nombre'] || headers['name'] || headers['insumo'] || headers['item'] || 1,
      descripcion: headers['descripcion'] || headers['description'] || headers['desc'] || 2,
      unidad: headers['unidad'] || headers['unit'] || headers['unid'] || 3,
      stock: headers['stock'] || headers['stock actual'] || headers['cantidad'] || headers['quantity'] || headers['currentstock'] || 4,
      minStock: headers['stock minimo'] || headers['minimo'] || headers['min stock'] || headers['minstock'] || headers['alerta'] || 5,
      costo: headers['costo'] || headers['costo unitario'] || headers['cost'] || headers['price'] || headers['precio'] || 6,
      proveedor: headers['proveedor'] || headers['supplier'] || headers['prov'] || 7
    };
    
    // Procesar filas (comenzando desde la fila 2)
    const rows = [];
    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber > 1) {
        rows.push(row);
      }
    });
    
    for (const row of rows) {
      results.total++;
      
      try {
        const getCellValue = (col) => {
          const cell = row.getCell(col);
          return cell.value;
        };
        
        const name = getCellValue(colMap.nombre)?.toString().trim();
        
        // Saltar filas sin nombre
        if (!name) {
          results.errors.push({ row: row.number, error: 'Nombre es requerido' });
          continue;
        }
        
        // Normalizar unidad
        let unit = getCellValue(colMap.unidad)?.toString().toLowerCase().trim() || 'unidad';
        if (!validUnits.includes(unit)) {
          // Intentar encontrar la unidad más cercana
          const normalized = validUnits.find(u => unit.includes(u) || u.includes(unit));
          unit = normalized || 'unidad';
        }
        
        const description = getCellValue(colMap.descripcion)?.toString().trim() || null;
        const currentStock = parseFloat(getCellValue(colMap.stock)) || 0;
        const minStock = parseFloat(getCellValue(colMap.minStock)) || 0;
        const costPerUnit = parseFloat(getCellValue(colMap.costo)) || null;
        const supplier = getCellValue(colMap.proveedor)?.toString().trim() || null;
        
        // Buscar si ya existe un insumo con el mismo nombre (ignorando case)
        const existingItem = await InventoryItem.findOne({
          where: {
            businessId,
            name: { [Op.iLike]: name },
            active: true
          }
        });
        
        if (existingItem) {
          // Actualizar insumo existente (solo campos proporcionados, no sobreescribir stock si es 0)
          const updateData = {};
          
          if (description !== null) updateData.description = description;
          if (unit !== existingItem.unit) updateData.unit = unit;
          if (currentStock > 0 || getCellValue(colMap.stock) !== undefined) {
            updateData.currentStock = currentStock;
          }
          if (minStock > 0 || getCellValue(colMap.minStock) !== undefined) {
            updateData.minStock = minStock;
          }
          if (costPerUnit !== null) updateData.costPerUnit = costPerUnit;
          if (supplier !== null) updateData.supplier = supplier;
          
          if (Object.keys(updateData).length > 0) {
            await existingItem.update(updateData);
            results.updated++;
          }
        } else {
          // Crear nuevo insumo
          await InventoryItem.create({
            businessId,
            name,
            description,
            unit,
            currentStock,
            minStock,
            costPerUnit,
            supplier
          });
          results.created++;
        }
      } catch (rowError) {
        results.errors.push({ 
          row: row.number, 
          error: rowError.message,
          name: row.getCell(colMap.nombre)?.value?.toString()
        });
      }
    }
    
    res.json({
      success: true,
      message: `Importación completada: ${results.created} creados, ${results.updated} actualizados`,
      results
    });
    
  } catch (e) {
    console.error('[importFromExcel] Error:', e);
    res.status(500).json({ error: e.message });
  }
};
