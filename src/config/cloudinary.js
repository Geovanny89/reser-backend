const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
require('dotenv').config();

// Configuración de Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// Configuración de Multer para Cloudinary
const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: 'kdice-reservas', // Carpeta principal
    allowed_formats: ['jpg', 'png', 'jpeg', 'webp'],
    transformation: [{ width: 1200, crop: 'limit', quality: 'auto' }], // Compresión automática
    public_id: (req, file) => {
      // Nombre único del archivo
      const cleanName = file.originalname.split('.')[0].replace(/\s+/g, '-');
      return `${Date.now()}-${cleanName}`;
    }
  }
});

// Función para extraer el public_id de una URL de Cloudinary
// Útil para eliminar archivos
const getPublicIdFromUrl = (url) => {
  if (!url || !url.includes('cloudinary')) return null;
  // Ejemplo: https://res.cloudinary.com/cloud_name/image/upload/v12345678/folder/public_id.jpg
  // El public_id sería "folder/public_id"
  const parts = url.split('/');
  const lastPart = parts[parts.length - 1]; // "public_id.jpg"
  const folderPart = parts[parts.length - 2]; // "folder"
  const publicId = `${folderPart}/${lastPart.split('.')[0]}`;
  return publicId;
};

// Función para eliminar imagen de Cloudinary
const deleteFromCloudinary = async (url) => {
  const publicId = getPublicIdFromUrl(url);
  if (!publicId) return;
  try {
    await cloudinary.uploader.destroy(publicId);
  } catch (e) {
    console.error('Error al eliminar de Cloudinary:', e);
  }
};

module.exports = {
  cloudinary,
  storage,
  deleteFromCloudinary
};
