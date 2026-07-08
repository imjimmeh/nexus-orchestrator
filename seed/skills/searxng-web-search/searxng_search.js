#!/usr/bin/env node

/**
 * SearXNG Web Search Client
 * Searches the web using a self-hosted SearXNG instance
 */

const http = require('http');
const https = require('https');
const { URL } = require('url');

// Configuration
const SEARXNG_BASE_URL = process.env.SEARXNG_URL || 'http://192.168.1.106:8122';

/**
 * Make an HTTP request and return parsed JSON response
 */
function httpRequest(url) {
    return new Promise((resolve, reject) => {
        const urlObj = new URL(url);
        const client = urlObj.protocol === 'https:' ? https : http;
        
        const req = client.get(url, { timeout: 10000 }, (res) => {
            let data = '';
            
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data));
                } catch (e) {
                    reject(new Error(`Failed to parse JSON response: ${e.message}`));
                }
            });
        });
        
        req.on('error', reject);
        req.on('timeout', () => {
            req.destroy();
            reject(new Error('Request timed out'));
        });
    });
}

/**
 * Search using SearXNG
 * @param {string} query - Search query
 * @param {Object} options - Optional search parameters
 * @returns {Promise<Array>} - Array of search results
 */
async function search(query, options = {}) {
    const params = new URLSearchParams({
        q: query,
        format: 'json',
        engines: options.engines || '',
        categories: options.categories || '',
        language: options.language || 'auto',
        safesearch: options.safesearch !== undefined ? options.safesearch : 0,
    });
    
    // Remove empty params
    for (const [key, value] of params.entries()) {
        if (!value) params.delete(key);
    }
    
    const url = `${SEARXNG_BASE_URL}/search?${params.toString()}`;
    console.log(`Searching: ${query}`);
    console.log(`URL: ${url}\n`);
    
    const results = await httpRequest(url);
    return results.results || [];
}

/**
 * Format and display search results
 */
function displayResults(results) {
    if (!results || results.length === 0) {
        console.log('No results found.\n');
        return;
    }
    
    console.log(`Found ${results.length} results:\n`);
    console.log('─'.repeat(80));
    
    results.forEach((result, index) => {
        console.log(`${index + 1}. ${result.title || 'No title'}`);
        console.log(`   URL: ${result.url}`);
        if (result.content) {
            console.log(`   ${result.content.substring(0, 200)}${result.content.length > 200 ? '...' : ''}`);
        }
        if (result.engines) {
            console.log(`   Engines: ${result.engines.join(', ')}`);
        }
        console.log('─'.repeat(80));
    });
}

// CLI Interface
async function main() {
    const args = process.argv.slice(2);
    
    if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
        console.log(`
SearXNG Web Search Client
Usage: node searxng_search.js <search query> [options]

Options:
  --engines <list>   Comma-separated list of search engines to use
  --categories <list> Search in specific categories (e.g., "general,news")
  --language <code>  Language code (default: auto)
  --safesearch <0-2>  Safe search level: 0=none, 1=moderate, 2=strict
  --help, -h         Show this help message

Environment Variables:
  SEARXNG_URL        SearXNG instance URL (default: ${SEARXNG_BASE_URL})

Example:
  node searxng_search.js "javascript async await"
  SEARXNG_URL=http://localhost:8888 node searxng_search.js "test"
`);
        process.exit(0);
    }
    
    const query = args.filter(a => !a.startsWith('--')).join(' ');
    const options = {};
    
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--engines' && args[i + 1]) options.engines = args[++i];
        if (args[i] === '--categories' && args[i + 1]) options.categories = args[++i];
        if (args[i] === '--language' && args[i + 1]) options.language = args[++i];
        if (args[i] === '--safesearch' && args[i + 1]) options.safesearch = parseInt(args[++i]);
    }
    
    if (!query) {
        console.error('Error: Please provide a search query.');
        console.error('Usage: node searxng_search.js <search query>');
        process.exit(1);
    }
    
    try {
        const results = await search(query, options);
        displayResults(results);
    } catch (error) {
        console.error(`Search failed: ${error.message}`);
        process.exit(1);
    }
}

main();
