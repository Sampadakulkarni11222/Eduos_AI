import swaggerJSDoc from 'swagger-jsdoc';
import { env } from './env.js';

const definition = {
  openapi: '3.0.0',
  info: {
    title: 'School ERP API',
    version: '1.0.0',
    description: 'RESTful API documentation for the School ERP system',
    contact: {
      name: 'API Support',
      email: 'support@schoolerp.com',
    },
  },
  servers: [
    {
      url: `http://${env.HOST}:${env.PORT}/api/v1`,
      description: env.isDev ? 'Development server' : 'Production server',
    },
  ],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
      },
    },
    responses: {
      Unauthorized: {
        description: 'Authentication required',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/ErrorResponse' },
          },
        },
      },
      NotFound: {
        description: 'Resource not found',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/ErrorResponse' },
          },
        },
      },
    },
    schemas: {
      SuccessResponse: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: true },
          message: { type: 'string' },
          data: { type: 'object' },
        },
      },
      ErrorResponse: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: false },
          message: { type: 'string' },
          errors: { type: 'array', items: { type: 'string' } },
        },
      },
      PaginationMeta: {
        type: 'object',
        properties: {
          total: { type: 'integer' },
          page: { type: 'integer' },
          limit: { type: 'integer' },
          totalPages: { type: 'integer' },
        },
      },
    },
  },
  security: [{ bearerAuth: [] }],
};

export const swaggerSpec = swaggerJSDoc({
  definition,
  apis: ['./src/routes/**/*.js', './src/modules/**/*.js'],
});
