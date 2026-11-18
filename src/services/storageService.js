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
    const cloudinary = require('cloudinary').v2;
    cloudinary.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME || 'lnhrxgwb',
      api_key: process.env.CLOUDINARY_API_KEY || '519762971172132',
      api_secret: process.env.CLOUDINARY_API_SECRET || 'oxlRMKpivmWFvWTcVtciiOKP5iA',
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
    this.providerName = (process.env.STORAGE_PROVIDER || 'cloudinary').toLowerCase();
    
    // Auto-detect: if cloudinary credentials are missing or set to local, fallback to local
    const hasCloudinary = Boolean(
      (process.env.CLOUDINARY_API_KEY || '519762971172132') &&
      (process.env.CLOUDINARY_API_SECRET || 'oxlRMKpivmWFvWTcVtciiOKP5iA') &&
      (process.env.CLOUDINARY_CLOUD_NAME || 'lnhrxgwb')
    );

    if (this.providerName === 'cloudinary' && hasCloudinary) {
      this.provider = new CloudinaryStorageProvider();
      logger.info('[StorageService] Initialized with Cloudinary Provider');
    } else {
      this.provider = new LocalDiskStorageProvider();
      this.providerName = 'local';
      logger.info('[StorageService] Initialized with Local Disk Provider');
    }
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
