const { HelpArticle, Op } = require('../models');

/**
 * Controlador para el centro de ayuda (Chatbot Administrativo)
 */

// 1. Simular respuesta de Chatbot
exports.chatQuery = async (req, res) => {
  try {
    const { message } = req.query;
    if (!message) {
      return res.json({
        answer: '¡Hola! Soy tu asistente de ayuda. ¿En qué puedo apoyarte hoy? Puedes preguntarme cómo realizar cualquier acción en la plataforma.'
      });
    }

    // Normalizar mensaje para búsqueda
    const normalizeText = (text) => {
      if (!text) return '';
      return text.toLowerCase().trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    };

    const query = normalizeText(message);
    
    // 1.0 Detectar saludos
    const greetings = ['hola', 'buenas', 'buenos dias', 'buenas tardes', 'buenas noches', 'que tal', 'saludos', 'hi', 'hello'];
    const cleanQuery = query.replace(/[¡!.,?¿]/g, '').trim();
    if (greetings.includes(cleanQuery) || cleanQuery === '') {
      return res.json({
        answer: '¡Hola! Soy tu asistente de ayuda de K-Dice. ¿En qué puedo apoyarte hoy? Puedes preguntarme sobre citas, profesionales, servicios, clientes, promociones o cierres de caja.'
      });
    }
    
    // 1.1 Detectar despedidas o agradecimientos
    const finishWords = ['gracias', 'chau', 'adios', 'listo', 'nada mas', 'entendido', 'perfecto', 'chao', 'graci'];
    if (finishWords.some(word => query.includes(word))) {
      return res.json({
        answer: '¡De nada! Ha sido un placer ayudarte. Si tienes más dudas en el futuro, aquí estaré. ¡Que tengas un excelente día!',
        isFinished: true
      });
    }

    // Palabras clave significativas (quitando 's' final para búsqueda básica de raíz)
    const words = query.split(' ')
      .filter(w => w.length > 2)
      .map(w => w.endsWith('s') ? w.slice(0, -1) : w); 

    // Buscar en la base de datos
    const articles = await HelpArticle.findAll({
      where: {
        isActive: true,
        [Op.or]: [
          { title: { [Op.iLike]: `%${query}%` } },
          { content: { [Op.iLike]: `%${query}%` } },
          { keywords: { [Op.iLike]: `%${query}%` } },
          // Búsqueda por palabras raíz
          ...words.map(word => ({
            [Op.or]: [
              { title: { [Op.iLike]: `%${word}%` } },
              { keywords: { [Op.iLike]: `%${word}%` } }
            ]
          }))
        ]
      }
    });

    if (articles.length === 0) {
      return res.json({
        answer: 'Lo siento, no encontré una guía específica para esa consulta. ¿Podrías intentar con otras palabras o ser más específico?'
      });
    }

    // Calcular relevancia en memoria
    const scoredArticles = articles.map(art => {
      const titleNorm = normalizeText(art.title);
      const keywordsNorm = normalizeText(art.keywords);
      const contentNorm = normalizeText(art.content);

      let score = 0;

      // 1. Coincidencia exacta con el título
      if (titleNorm === query) {
        score += 1000;
      }
      // 2. Coincidencia parcial de la consulta exacta en el título
      else if (titleNorm.includes(query)) {
        score += 500;
      }

      // 3. Coincidencia de la consulta exacta en las palabras clave
      if (keywordsNorm.includes(query)) {
        score += 300;
      }

      // 4. Coincidencia de la consulta exacta en el contenido
      if (contentNorm.includes(query)) {
        score += 100;
      }

      // 5. Coincidencias de palabras individuales
      words.forEach(word => {
        if (titleNorm.includes(word)) {
          score += 50;
        }
        if (keywordsNorm.includes(word)) {
          score += 30;
        }
        if (contentNorm.includes(word)) {
          score += 10;
        }
      });

      // 6. Penalización por la columna 'order'
      score -= (art.order || 0) * 0.1;

      return { article: art, score };
    });

    // Ordenar de mayor a menor puntuación
    scoredArticles.sort((a, b) => b.score - a.score);

    // Devolver el de mayor relevancia
    const bestMatch = scoredArticles[0].article;

    return res.json({
      answer: `He encontrado esto para ti: **${bestMatch.title}**\n\n${bestMatch.content}`,
      article: bestMatch
    });

  } catch (error) {
    console.error('[HelpController] Error en chatQuery:', error);
    res.status(500).json({ error: 'Error procesando tu consulta de ayuda' });
  }
};

// 2. Obtener todos los artículos (para un FAQ o buscador)
exports.getAllArticles = async (req, res) => {
  try {
    const { category } = req.query;
    const where = { isActive: true };
    if (category) where.category = category;

    const articles = await HelpArticle.findAll({
      where,
      order: [['category', 'ASC'], ['order', 'ASC']]
    });

    res.json(articles);
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener artículos de ayuda' });
  }
};

// 3. Gestión de artículos (para SuperAdmin)
const { deleteFromCloudinary } = require('../config/cloudinary');

exports.createArticle = async (req, res) => {
  try {
    const data = { ...req.body };
    
    // Si viene una imagen de multer
    if (req.file) {
      data.imageUrl = req.file.path;
      data.imagePublicId = req.file.filename;
    }

    const article = await HelpArticle.create(data);
    res.status(201).json(article);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

exports.updateArticle = async (req, res) => {
  try {
    const { id } = req.params;
    const article = await HelpArticle.findByPk(id);
    if (!article) return res.status(404).json({ error: 'Artículo no encontrado' });
    
    const data = { ...req.body };

    // Si viene una imagen nueva
    if (req.file) {
      // Eliminar imagen anterior de Cloudinary si existe
      if (article.imageUrl) {
        await deleteFromCloudinary(article.imageUrl);
      }
      data.imageUrl = req.file.path;
      data.imagePublicId = req.file.filename;
    }

    await article.update(data);
    res.json(article);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

exports.deleteArticle = async (req, res) => {
  try {
    const { id } = req.params;
    const article = await HelpArticle.findByPk(id);
    if (!article) return res.status(404).json({ error: 'Artículo no encontrado' });
    
    // Eliminar imagen de Cloudinary si existe
    if (article.imageUrl) {
      await deleteFromCloudinary(article.imageUrl);
    }

    await article.destroy();
    res.json({ message: 'Artículo eliminado correctamente' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
