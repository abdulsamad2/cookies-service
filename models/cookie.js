import mongoose from "mongoose";

// Cookie Storage Schema - Enhanced for standalone service
const cookieSchema = new mongoose.Schema(
  {
    // Unique identifier for the cookie set
    cookieId: {
      type: String,
      required: true,
    },
    // The actual cookie data
    cookies: {
      type: mongoose.Schema.Types.Mixed,
      required: true,
    },
    // Source information
    source: {
      eventId: {
        type: String,
        required: false,
      },
      refreshId: {
        type: String,
        required: false,
      },
      proxy: {
        type: String,
        required: false,
      },
      userAgent: {
        type: String,
        required: false,
      },
    },
    // Cookie metadata
    metadata: {
      domain: {
        type: String,
        required: false,
      },
      path: {
        type: String,
        default: '/',
      },
      secure: {
        type: Boolean,
        default: false,
      },
      httpOnly: {
        type: Boolean,
        default: false,
      },
      sameSite: {
        type: String,
        enum: ['Strict', 'Lax', 'None'],
        default: 'Lax',
      },
    },
    // Validity and usage tracking
    validity: {
      isValid: {
        type: Boolean,
        default: true,
      },
      expiresAt: {
        type: Date,
        required: false,
      },
      lastUsed: {
        type: Date,
        default: Date.now,
      },
      usageCount: {
        type: Number,
        default: 0,
      },
    },
    // Quality metrics
    quality: {
      score: {
        type: Number,
        min: 0,
        max: 100,
        default: 100,
      },
      successRate: {
        type: Number,
        min: 0,
        max: 100,
        default: 100,
      },
      lastSuccessful: {
        type: Date,
        default: Date.now,
      },
    },
    // Status tracking
    status: {
      type: String,
      enum: ['active', 'inactive', 'expired', 'failed'],
      default: 'active',
    },
    // Tags for categorization
    tags: [{
      type: String,
    }],
  },
  {
    timestamps: true,
  }
);

// Create indexes for efficient querying
cookieSchema.index({ cookieId: 1 }, { unique: true });
cookieSchema.index({ status: 1 });
cookieSchema.index({ 'validity.isValid': 1 });
cookieSchema.index({ 'validity.expiresAt': 1 });
cookieSchema.index({ 'validity.lastUsed': -1 });
cookieSchema.index({ 'quality.score': -1 });
cookieSchema.index({ 'source.eventId': 1 });
cookieSchema.index({ 'source.refreshId': 1 });
cookieSchema.index({ tags: 1 });
cookieSchema.index({ createdAt: -1 });

// Compound indexes for common queries
cookieSchema.index({ status: 1, 'validity.isValid': 1, 'quality.score': -1 });

export const Cookie = mongoose.model("Cookie", cookieSchema);