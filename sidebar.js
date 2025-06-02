class SidebarChatAssistant {
  constructor() {
    this.apiKey = "";
    this.messages = [];
    this.currentPageData = null;
    this.zoomLevel = 'zoom-normal';
    this.currentUrl = null;

    this.initializeElements();
    this.loadStoredData();
    this.setupEventListeners();
    this.loadPageContent();
    this.focusInput();
  }

  initializeElements() {
    this.apiKeyInput = document.getElementById("apiKey");
    this.messagesContainer = document.getElementById("messages");
    this.messageInput = document.getElementById("messageInput");
    this.sendButton = document.getElementById("sendButton");
    this.status = document.getElementById("status");
    this.zoomInBtn = document.getElementById("zoomIn");
    this.zoomOutBtn = document.getElementById("zoomOut");
    this.clearBtn = document.getElementById("clearConvo");
  }

  async loadStoredData() {
    try {
      const result = await chrome.storage.sync.get(["apiKey", "zoomLevel"]);
      if (result.apiKey) {
        this.apiKey = result.apiKey;
        this.apiKeyInput.value = result.apiKey;
      }
      if (result.zoomLevel) {
        this.zoomLevel = result.zoomLevel;
        this.applyZoom();
      }
    } catch (error) {
      console.error("Error loading stored data:", error);
    }
  }

  async loadMessagesForUrl(url) {
    try {
      const urlKey = `messages_${this.sanitizeUrl(url)}`;
      const result = await chrome.storage.sync.get([urlKey]);
      if (result[urlKey]) {
        this.messages = result[urlKey];
        this.renderMessages();
      } else {
        this.messages = [];
        this.renderMessages();
      }
    } catch (error) {
      console.error("Error loading messages for URL:", error);
    }
  }

  sanitizeUrl(url) {
    return url.replace(/https?:\/\//, '').replace(/[^a-zA-Z0-9]/g, '_').substring(0, 100);
  }

  async saveData() {
    try {
      const data = {
        apiKey: this.apiKey,
        zoomLevel: this.zoomLevel,
      };
      
      if (this.currentUrl) {
        const urlKey = `messages_${this.sanitizeUrl(this.currentUrl)}`;
        data[urlKey] = this.messages;
      }
      
      await chrome.storage.sync.set(data);
    } catch (error) {
      console.error("Error saving data:", error);
    }
  }

  setupEventListeners() {
    this.apiKeyInput.addEventListener("input", (e) => {
      this.apiKey = e.target.value;
      this.saveData();
    });

    this.sendButton.addEventListener("click", () => {
      this.sendMessage();
    });

    this.messageInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        this.sendMessage();
      }
    });

    this.zoomInBtn.addEventListener("click", () => {
      this.zoomIn();
    });

    this.zoomOutBtn.addEventListener("click", () => {
      this.zoomOut();
    });

    this.clearBtn.addEventListener("click", () => {
      this.clearConversation();
    });
  }

  async loadPageContent() {
    try {
      // Get the page data from storage (set by popup before opening sidebar)
      const result = await chrome.storage.local.get(["sidebarPageData"]);
      if (result.sidebarPageData) {
        this.currentPageData = result.sidebarPageData;
        this.currentUrl = result.sidebarPageData.url;
        this.loadMessagesForUrl(result.sidebarPageData.url);
        this.setStatus(`Page loaded: ${result.sidebarPageData.title}`);
        await chrome.storage.local.remove(["sidebarPageData"]);
      } else {
        this.setStatus('No page data available. Please use the extension popup first.');
      }
    } catch (error) {
      this.setStatus('Error loading page content');
      console.error(error);
    }
  }

  setStatus(message, isLoading = false) {
    this.status.textContent = message;
    this.status.className = isLoading ? "status loading" : "status";
  }

  async sendMessage() {
    const message = this.messageInput.value.trim();
    if (!message) return;

    if (!this.apiKey) {
      this.setStatus("Please enter your OpenAI API key");
      return;
    }

    if (!this.currentPageData) {
      this.setStatus("No page content available");
      return;
    }

    this.messageInput.value = "";
    this.sendButton.disabled = true;

    this.addMessage("user", message);
    this.setStatus("Thinking...", true);

    const assistantMessageEl = this.addStreamingMessage("assistant");

    try {
      await this.streamOpenAI(message, assistantMessageEl);
      this.setStatus("");
    } catch (error) {
      assistantMessageEl.textContent =
        "Sorry, I encountered an error. Please check your API key and try again.";
      this.setStatus("Error occurred");
      console.error(error);
    }

    this.sendButton.disabled = false;
  }

  async streamOpenAI(userMessage, messageElement) {
    const systemMessage = `You are a helpful assistant that can answer questions about webpage content. 

Current webpage information:
Title: ${this.currentPageData.title}
URL: ${this.currentPageData.url}

Page content:
${this.currentPageData.text}

Please answer the user's question based on this webpage content. Be helpful and accurate.`;

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        messages: [
          { role: "system", content: systemMessage },
          { role: "user", content: userMessage },
        ],
        max_tokens: 1500,
        temperature: 0.7,
        stream: true,
      }),
    });

    if (!response.ok) {
      throw new Error(`API request failed: ${response.status}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let fullResponse = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split("\n");

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const data = line.slice(6);
            if (data === "[DONE]") continue;

            try {
              const parsed = JSON.parse(data);
              const content = parsed.choices?.[0]?.delta?.content;
              if (content) {
                fullResponse += content;
                messageElement.innerHTML = MarkdownParser.parse(fullResponse);
                this.messagesContainer.scrollTop =
                  this.messagesContainer.scrollHeight;
              }
            } catch (e) {
              // Skip malformed JSON
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    // Store the complete message
    const lastMessage = this.messages[this.messages.length - 1];
    if (lastMessage && lastMessage.role === "assistant") {
      lastMessage.content = fullResponse;
    }
    this.saveData();
  }

  addMessage(role, content) {
    this.messages.push({ role, content, timestamp: Date.now() });
    this.renderMessages();
    this.saveData();
  }

  addStreamingMessage(role) {
    const messageEl = document.createElement("div");
    messageEl.className = `message ${role}`;
    messageEl.textContent = "";
    this.messagesContainer.appendChild(messageEl);
    this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;

    // Add placeholder to messages array
    this.messages.push({ role, content: "", timestamp: Date.now() });

    return messageEl;
  }

  renderMessages() {
    this.messagesContainer.innerHTML = "";

    if (this.messages.length === 0) {
      const welcomeEl = document.createElement("div");
      welcomeEl.className = "message assistant";
      welcomeEl.textContent = "Welcome! Enter your OpenAI API key above, then ask me anything about the webpage you were viewing.";
      this.messagesContainer.appendChild(welcomeEl);
      return;
    }

    this.messages.forEach((message) => {
      const messageEl = document.createElement("div");
      messageEl.className = `message ${message.role}`;
      
      if (message.role === 'assistant') {
        messageEl.innerHTML = MarkdownParser.parse(message.content);
      } else {
        messageEl.textContent = message.content;
      }
      
      this.messagesContainer.appendChild(messageEl);
    });

    this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
  }

  focusInput() {
    setTimeout(() => {
      if (this.apiKey) {
        this.messageInput.focus();
      } else {
        this.apiKeyInput.focus();
      }
    }, 100);
  }

  zoomIn() {
    const levels = ['zoom-small', 'zoom-normal', 'zoom-large', 'zoom-extra-large'];
    const currentIndex = levels.indexOf(this.zoomLevel);
    if (currentIndex < levels.length - 1) {
      this.zoomLevel = levels[currentIndex + 1];
      this.applyZoom();
      this.saveData();
    }
  }

  zoomOut() {
    const levels = ['zoom-small', 'zoom-normal', 'zoom-large', 'zoom-extra-large'];
    const currentIndex = levels.indexOf(this.zoomLevel);
    if (currentIndex > 0) {
      this.zoomLevel = levels[currentIndex - 1];
      this.applyZoom();
      this.saveData();
    }
  }

  applyZoom() {
    const body = document.body;
    body.className = body.className.replace(/zoom-\w+/g, '');
    body.classList.add(this.zoomLevel);
  }

  async clearConversation() {
    if (confirm('Clear conversation for this page?')) {
      this.messages = [];
      this.renderMessages();
      this.saveData();
      this.setStatus('Conversation cleared');
    }
  }
}

document.addEventListener("DOMContentLoaded", () => {
  new SidebarChatAssistant();
});