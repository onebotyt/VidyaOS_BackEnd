/**
 * Self-Hosted Institutional WhatsApp Web Bot Service (Option 2)
 * Powered by whatsapp-web.js with LocalAuth & Chromium
 * 
 * Provides:
 * - 100% Free / Zero-Cost WhatsApp OTP delivery directly from college phone/SIM
 * - Automated session persistence in whatsapp_session/
 * - Real-time QR Code generation for Admin scan (Linked Devices)
 * - Safe fallback to direct links/scan cards when bot is unlinked
 */

const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const path = require('path');
const logger = require('../utils/logger');

class WhatsAppBotService {
  constructor() {
    this.client = null;
    this.state = {
      status: 'DISCONNECTED', // 'DISCONNECTED' | 'INITIALIZING' | 'QR_READY' | 'AUTHENTICATED' | 'CONNECTED'
      qrRaw: null,
      qrDataUrl: null,
      connectedUser: null,
      lastError: null,
      startedAt: null
    };
    this.isInitializing = false;
  }

  /**
   * Initializes the WhatsApp Web Bot
   * Resolves Chromium from Playwright/System and attaches event listeners
   */
  async initialize() {
    if (this.state.status === 'CONNECTED') {
      return { success: true, message: 'WhatsApp Bot is already connected', status: this.state.status };
    }
    if (this.isInitializing) {
      return { success: true, message: 'WhatsApp Bot initialization is already in progress', status: this.state.status };
    }

    this.isInitializing = true;
    this.state.status = 'INITIALIZING';
    this.state.lastError = null;
    this.state.startedAt = new Date().toISOString();

    try {
      // Resolve Chromium executable path: prioritize environment variable (e.g. Docker / Linux), then Playwright
      let executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
      if (!executablePath) {
        try {
          const { chromium } = require('playwright');
          executablePath = chromium.executablePath();
        } catch (err) {
          logger.warn('[WHATSAPP BOT] Playwright chromium not found, relying on default puppeteer browser');
        }
      }

      const sessionDir = process.env.WHATSAPP_SESSION_DIR
        ? (path.isAbsolute(process.env.WHATSAPP_SESSION_DIR) ? process.env.WHATSAPP_SESSION_DIR : path.resolve(process.cwd(), process.env.WHATSAPP_SESSION_DIR))
        : path.resolve(__dirname, '../../whatsapp_session');

      this.client = new Client({
        authStrategy: new LocalAuth({
          dataPath: sessionDir
        }),
        puppeteer: {
          headless: true,
          executablePath: executablePath || undefined,
          args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--disable-gpu'
          ]
        }
      });

      this._attachEventHandlers();

      // Launch in background without blocking
      this.client.initialize().catch(err => {
        logger.error(`[WHATSAPP BOT] Client initialize error: ${err.message}`);
        this.state.status = 'DISCONNECTED';
        this.state.lastError = err.message;
        this.isInitializing = false;
      });

      return {
        success: true,
        message: 'WhatsApp Bot initialization started. Scan QR code when ready.',
        status: this.state.status
      };
    } catch (err) {
      this.isInitializing = false;
      this.state.status = 'DISCONNECTED';
      this.state.lastError = err.message;
      logger.error(`[WHATSAPP BOT] Initialization failed: ${err.message}`);
      return { success: false, message: err.message, status: this.state.status };
    }
  }

  _attachEventHandlers() {
    if (!this.client) return;

    this.client.on('qr', async (qr) => {
      this.state.qrRaw = qr;
      this.isInitializing = false;
      try {
        this.state.qrDataUrl = await qrcode.toDataURL(qr, { margin: 2, scale: 6 });
      } catch (err) {
        logger.warn(`[WHATSAPP BOT] QR DataURL conversion warning: ${err.message}`);
        this.state.qrDataUrl = null;
      }
      this.state.status = 'QR_READY';
      logger.info('[WHATSAPP BOT] >>> Scan QR code via WhatsApp -> Settings -> Linked Devices <<<');
    });

    this.client.on('authenticated', () => {
      this.state.status = 'AUTHENTICATED';
      this.isInitializing = false;
      logger.info('[WHATSAPP BOT] Client authenticated successfully');
    });

    this.client.on('ready', () => {
      this.state.status = 'CONNECTED';
      this.state.qrRaw = null;
      this.state.qrDataUrl = null;
      this.isInitializing = false;

      const info = this.client.info || {};
      this.state.connectedUser = {
        phone: info.wid?.user || 'Connected Phone',
        pushname: info.pushname || 'Institutional WhatsApp',
        platform: info.platform || 'whatsapp'
      };

      logger.info(`[WHATSAPP BOT] 🟢 WhatsApp Bot READY! Connected: +${this.state.connectedUser.phone} (${this.state.connectedUser.pushname})`);
    });

    this.client.on('auth_failure', (msg) => {
      this.state.status = 'DISCONNECTED';
      this.state.lastError = msg;
      this.isInitializing = false;
      logger.error(`[WHATSAPP BOT] Authentication failed: ${msg}`);
    });

    this.client.on('disconnected', (reason) => {
      this.state.status = 'DISCONNECTED';
      this.state.qrRaw = null;
      this.state.qrDataUrl = null;
      this.state.connectedUser = null;
      this.isInitializing = false;
      logger.warn(`[WHATSAPP BOT] WhatsApp Bot disconnected: ${reason}`);
    });
  }

  /**
   * Check if bot is active and ready to dispatch
   */
  isConnected() {
    return this.state.status === 'CONNECTED' && this.client !== null;
  }

  /**
   * Get current connection telemetry & QR code image
   */
  getStatus() {
    return {
      status: this.state.status,
      is_connected: this.state.status === 'CONNECTED',
      is_qr_ready: this.state.status === 'QR_READY',
      qr_code_url: this.state.qrDataUrl,
      connected_user: this.state.connectedUser,
      last_error: this.state.lastError,
      started_at: this.state.startedAt
    };
  }

  /**
   * Send WhatsApp message directly to Indian / international phone number
   */
  async sendMessage(phone, messageText) {
    if (!this.isConnected()) {
      return { success: false, reason: 'BOT_NOT_CONNECTED', status: this.state.status };
    }

    let cleanPhone = String(phone).replace(/\D/g, '');
    if (cleanPhone.startsWith('91') && cleanPhone.length === 12) {
      // already formatted with 91
    } else if (cleanPhone.length === 10) {
      cleanPhone = `91${cleanPhone}`;
    }

    const chatId = `${cleanPhone}@c.us`;

    try {
      const result = await this.client.sendMessage(chatId, messageText);
      logger.info(`[WHATSAPP BOT] Direct message dispatched to +${cleanPhone}`);
      return {
        success: true,
        delivered: true,
        messageId: result.id?._serialized,
        channel: 'WHATSAPP_BOT'
      };
    } catch (err) {
      logger.error(`[WHATSAPP BOT] Failed to dispatch to +${cleanPhone}: ${err.message}`);
      return { success: false, reason: err.message };
    }
  }

  /**
   * Disconnect and destroy current WhatsApp session
   */
  async disconnect() {
    if (this.client) {
      try {
        await this.client.destroy();
      } catch (_) {}
      this.client = null;
    }
    this.state.status = 'DISCONNECTED';
    this.state.qrRaw = null;
    this.state.qrDataUrl = null;
    this.state.connectedUser = null;
    this.isInitializing = false;
    return { success: true, message: 'WhatsApp Bot disconnected' };
  }
}

module.exports = new WhatsAppBotService();
