/**
 * Grok API Proxy Server
 * Proxies AI calls from frontend to Grok API, keeping API key server-side
 */

import 'dotenv/config';
import express from 'express';
import OpenAI from 'openai';

const app = express();
const PORT = process.env.API_SERVER_PORT || 3001;

// Initialize OpenAI client with server-side API key
const openai = new OpenAI({
  apiKey: process.env.XAI_API_KEY,
  baseURL: 'https://api.x.ai/v1',
});

// Responses API type definitions
type ResponsesAPIInput = {
  role: 'user' | 'assistant';
  content: string;
};

type ResponsesAPITool = { type: 'web_search' } | { type: 'x_search' };

app.use(express.json());

// Proxy endpoint for all AI calls
app.post('/api/ai', async (req, res) => {
  const { callType, params } = req.body;

  if (!callType || !params) {
    res.status(400).json({ error: 'Missing callType or params' });
    return;
  }

  try {
    let response;

    switch (callType) {
      case 'responses':
        // Responses API (web_search, x_search)
        response = await (openai as any).responses.create({
          ...params,
          tools: params.tools as ResponsesAPITool[],
        });
        break;

      case 'chat':
        // Chat Completions API
        response = await openai.chat.completions.create(params);
        break;

      default:
        res.status(400).json({ error: `Unknown callType: ${callType}` });
        return;
    }

    res.json(response);
  } catch (error) {
    console.error('AI API error:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'AI API call failed',
    });
  }
});

app.listen(PORT, () => {
  console.log(`Grok API proxy server running on port ${PORT}`);
});
