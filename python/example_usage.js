/**
 * Example usage of FastVLM Inference Server from JavaScript/TypeScript
 *
 * This file demonstrates how to interact with the Python server
 * from Node.js, Electron, or browser JavaScript.
 */

// Example 1: Simple fetch request (works in browser and Node.js)
async function analyzeScreenshotSimple(imagePath) {
  const response = await fetch('http://localhost:5123/analyze', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      image_path: imagePath
    })
  });

  if (!response.ok) {
    throw new Error(`Server error: ${response.status}`);
  }

  const result = await response.json();

  if (result.success) {
    console.log('Description:', result.description);
    console.log('Confidence:', result.confidence);
  } else {
    console.error('Analysis failed:', result.error);
  }

  return result;
}

// Example 2: With custom prompt and parameters
async function analyzeScreenshotCustom(imagePath) {
  const response = await fetch('http://localhost:5123/analyze', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      image_path: imagePath,
      prompt: 'Describe the code visible in this IDE screenshot. Focus on the programming language, frameworks, and what the developer is working on.',
      max_tokens: 300,
      temperature: 0.5
    })
  });

  const result = await response.json();
  return result;
}

// Example 3: Using base64-encoded image
async function analyzeScreenshotBase64(base64Data) {
  const response = await fetch('http://localhost:5123/analyze', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      image_base64: base64Data
    })
  });

  const result = await response.json();
  return result;
}

// Example 4: Health check
async function checkServerHealth() {
  try {
    const response = await fetch('http://localhost:5123/health');
    const health = await response.json();

    console.log('Server status:', health.status);
    console.log('Model loaded:', health.model_loaded);

    return health.status === 'healthy';
  } catch (error) {
    console.error('Server not reachable:', error);
    return false;
  }
}

// Example 5: Complete Electron integration class
class FastVLMClient {
  constructor(serverUrl = 'http://localhost:5123') {
    this.serverUrl = serverUrl;
    this.isHealthy = false;
  }

  async checkHealth() {
    try {
      const response = await fetch(`${this.serverUrl}/health`);
      const data = await response.json();
      this.isHealthy = data.status === 'healthy' && data.model_loaded;
      return this.isHealthy;
    } catch (error) {
      this.isHealthy = false;
      return false;
    }
  }

  async analyze(imagePath, options = {}) {
    if (!this.isHealthy) {
      await this.checkHealth();
      if (!this.isHealthy) {
        throw new Error('FastVLM server is not healthy');
      }
    }

    const {
      prompt = null,
      maxTokens = 200,
      temperature = 0.7
    } = options;

    const response = await fetch(`${this.serverUrl}/analyze`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        image_path: imagePath,
        prompt,
        max_tokens: maxTokens,
        temperature
      })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.detail || 'Analysis failed');
    }

    return await response.json();
  }

  async analyzeBase64(base64Data, options = {}) {
    if (!this.isHealthy) {
      await this.checkHealth();
      if (!this.isHealthy) {
        throw new Error('FastVLM server is not healthy');
      }
    }

    const {
      prompt = null,
      maxTokens = 200,
      temperature = 0.7
    } = options;

    const response = await fetch(`${this.serverUrl}/analyze`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        image_base64: base64Data,
        prompt,
        max_tokens: maxTokens,
        temperature
      })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.detail || 'Analysis failed');
    }

    return await response.json();
  }
}

// TypeScript type definitions for reference
/**
 * @typedef {Object} AnalyzeResponse
 * @property {string} description - AI-generated description
 * @property {number} confidence - Confidence score (0.0-1.0)
 * @property {boolean} success - Whether analysis succeeded
 * @property {string} [error] - Error message if failed
 */

/**
 * @typedef {Object} HealthResponse
 * @property {string} status - Server status
 * @property {boolean} model_loaded - Whether model is loaded
 * @property {Object} model_info - Model information
 */

// Example usage demonstration
if (typeof require !== 'undefined' && require.main === module) {
  // Running as a script - demonstrate usage
  (async () => {
    console.log('FastVLM Client Example Usage\n');

    // Check server health
    console.log('1. Checking server health...');
    const isHealthy = await checkServerHealth();
    console.log(`   Server is ${isHealthy ? 'healthy' : 'not available'}\n`);

    if (!isHealthy) {
      console.log('Please start the server first:');
      console.log('  cd python/');
      console.log('  source venv/bin/activate');
      console.log('  python server.py');
      return;
    }

    // Analyze a screenshot (replace with actual path)
    const testImagePath = process.argv[2];
    if (!testImagePath) {
      console.log('Usage: node example_usage.js /path/to/screenshot.png');
      return;
    }

    console.log(`2. Analyzing screenshot: ${testImagePath}`);
    try {
      const result = await analyzeScreenshotSimple(testImagePath);
      console.log('\nSuccess!');
      console.log(`   Description: ${result.description}`);
      console.log(`   Confidence: ${result.confidence}\n`);
    } catch (error) {
      console.error('Failed:', error.message);
    }

    // Using the client class
    console.log('3. Using FastVLMClient class...');
    const client = new FastVLMClient();
    await client.checkHealth();

    if (client.isHealthy) {
      const result = await client.analyze(testImagePath, {
        temperature: 0.5,
        maxTokens: 250
      });
      console.log(`   Result: ${result.description.substring(0, 80)}...\n`);
    }
  })();
}

// Export for use as module
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    analyzeScreenshotSimple,
    analyzeScreenshotCustom,
    analyzeScreenshotBase64,
    checkServerHealth,
    FastVLMClient
  };
}
