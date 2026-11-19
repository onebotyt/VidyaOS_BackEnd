/**
 * Cloud Storage Adapter Abstraction
 * 
 * Provides a provider-agnostic interface for uploading and deleting media/files.
 * Future providers (AWS S3, Google Cloud Storage, Azure Blob, MinIO, etc.) can be
 * added by creating a new provider class adhering to the StorageProvider contract.
 */

const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

class StorageProvider {
  /**
   * Upload a file
   * @param {Object} file - Express/Multer file object (path, filename, mimetype, originalname, size)
   * @param {Object} options - Options (subfolder, publicId, etc.)
   * @returns {Promise<{ url: string, publicId: string, provider: string, raw: any }>}
   */
  async upload(file, options = {}) {
    throw new Error('Method upload() must be implemented');
  }

  /**
   * Delete a file
   * @param {string} publicId - Public identifier or relative file path
   * @returns {Promise<boolean>}
   */
  async delete(publicId) {
    throw new Error('Method delete() must be implemented');
  }
}

/**
 * Cloudinary Storage Provider
 */
class CloudinaryStorageProvider extends StorageProvider {
  constructor() {
    super();
    let cloudinary;
    try {
      cloudinary = require('cloudinary').v2;
    } catch (e) {
      throw new Error("Optional package 'cloudinary' is not installed.");
    }
    cloudinary.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key: process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET,
      secure: true
    });
    this.cloudinary = cloudinary;
  }

  async upload(file, options = {}) {
    const folder = options.subfolder ? `vidyaos/${options.subfolder}` : 'vidyaos/media';
    
    // Cloudinary automatically infers or supports resource_type: 'auto' (image, video, raw documents like pdf, zip, etc.)
    const result = await this.cloudinary.uploader.upload(file.path, {
      folder,
      resource_type: 'auto',
      use_filename: true,
      unique_filename: true
    });

    // Optionally cleanup the local temp file uploaded by multer
    try {
      if (fs.existsSync(file.path)) {
        fs.unlinkSync(file.path);
      }
    } catch (cleanupErr) {
      logger.warn('[CloudinaryStorageProvider] Local temp cleanup warning:', { error: cleanupErr.message });
    }

    return {
      url: result.secure_url || result.url,
      publicId: result.public_id,
      provider: 'cloudinary',
      raw: result
    };
  }

  async delete(publicId) {
    try {
      const result = await this.cloudinary.uploader.destroy(publicId);
      return result.result === 'ok';
    } catch (err) {
      logger.warn('[CloudinaryStorageProvider] Delete failed:', { error: err.message, publicId });
      return false;
    }
  }
}

/**
 * Local Disk Storage Provider (Fallback / Offline)
 */
class LocalDiskStorageProvider extends StorageProvider {
  constructor() {
    super();
    this.uploadRoot = process.env.UPLOADS_DIR
      ? (path.isAbsolute(process.env.UPLOADS_DIR) ? process.env.UPLOADS_DIR : path.resolve(process.cwd(), process.env.UPLOADS_DIR))
      : path.join(__dirname, '../../uploads');
  }

  async upload(file, options = {}) {
    const subfolder = options.subfolder || 'media';
    const relativePath = `/uploads/${subfolder}/${file.filename}`;
    return {
      url: relativePath,
      publicId: file.filename,
      provider: 'local',
      raw: { path: file.path }
    };
  }

  async delete(publicId) {
    try {
      // Find and delete from uploads directory
      const filePath = path.join(this.uploadRoot, 'media', publicId);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        return true;
      }
    } catch (err) {
      logger.warn('[LocalDiskStorageProvider] Delete failed:', { error: err.message, publicId });
    }
    return false;
  }
}

/**
 * Storage Service Factory
 * Controlled by STORAGE_PROVIDER environment variable:
 * - 'cloudinary' (Default when credentials exist)
 * - 'local'
 * - In future: 's3', 'gcs', 'azure', etc.
 */
class StorageService {
  constructor() {
    const isProduction = process.env.NODE_ENV === 'production';
    const reqProvider = (process.env.STORAGE_PROVIDER || (isProduction ? 'cloudinary' : 'local')).toLowerCase();
    
    // Cloudinary is only activated when explicitly requested AND cloud credentials are provided
    const hasCloudinaryEnv = Boolean(
      process.env.CLOUDINARY_API_KEY &&
      process.env.CLOUDINARY_API_SECRET &&
      process.env.CLOUDINARY_CLOUD_NAME
    );

    if (reqProvider === 'cloudinary' && hasCloudinaryEnv) {
      try {
        this.provider = new CloudinaryStorageProvider();
        this.providerName = 'cloudinary';
        logger.info('[StorageService] Initialized with Cloudinary Provider');
        return;
      } catch (err) {
        logger.warn('[StorageService] Cloudinary init failed, falling back to Local Disk Provider:', { error: err.message });
      }
    }

    // Default to Local Disk Provider (Local testing / offline development)
    this.provider = new LocalDiskStorageProvider();
    this.providerName = 'local';
    logger.info('[StorageService] Initialized with Local Disk Provider (Local Storage)');
  }

  /**
   * Upload file via active provider
   */
  async upload(file, options = {}) {
    return this.provider.upload(file, options);
  }

  /**
   * Delete file via active provider
   */
  async delete(publicId) {
    return this.provider.delete(publicId);
  }

  /**
   * Get active provider name
   */
  getProviderName() {
    return this.providerName;
  }
}

module.exports = new StorageService();
