class PageChatAssistant {
  constructor() {
    this.apiKey = "";
    this.messages = [];
    this.currentPageData = null;
    this.zoomLevel = 'zoom-normal';

    this.initializeElements();
    this.loadStoredData();
    this.setupEventListeners();
    this.extractPageContent();
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
    this.toggleModeBtn = document.getElementById("toggleMode");
  }

  async loadStoredData() {
    try {
      const result = await chrome.storage.sync.get(["apiKey", "messages", "zoomLevel"]);
      if (result.apiKey) {
        this.apiKey = result.apiKey;
        this.apiKeyInput.value = result.apiKey;
      }
      if (result.messages) {
        this.messages = result.messages;
        this.renderMessages();
      }
      if (result.zoomLevel) {
        this.zoomLevel = result.zoomLevel;
        this.applyZoom();
      }
    } catch (error) {
      console.error("Error loading stored data:", error);
    }
  }

  async saveData() {
    try {
      await chrome.storage.sync.set({
        apiKey: this.apiKey,
        messages: this.messages,
        zoomLevel: this.zoomLevel,
      });
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

    this.toggleModeBtn.addEventListener("click", () => {
      this.toggleSidebarMode();
    });
  }

  async extractPageContent() {
    try {
      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });

      const tryExtract = async (retries = 3) => {
        return new Promise((resolve) => {
          chrome.tabs.sendMessage(
            tab.id,
            { action: "extractText" },
            async (response) => {
              if (chrome.runtime.lastError) {
                if (retries > 0) {
                  setTimeout(async () => {
                    try {
                      await chrome.scripting.executeScript({
                        target: { tabId: tab.id },
                        files: ["content.js"],
                      });

                      setTimeout(() => {
                        resolve(tryExtract(retries - 1));
                      }, 500);
                    } catch (error) {
                      console.error("Failed to inject content script:", error);
                      resolve(null);
                    }
                  }, 200);
                } else {
                  this.setStatus(
                    "Could not access page content. Try refreshing the page."
                  );
                  resolve(null);
                }
                return;
              }

              if (response) {
                this.currentPageData = response;
                this.setStatus(`Page loaded: ${response.title}`);
                resolve(response);
              } else {
                resolve(null);
              }
            }
          );
        });
      };

      await tryExtract();
    } catch (error) {
      this.setStatus("Error accessing current tab");
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
      this.setStatus("Please wait for page content to load");
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
        max_tokens: 1000,
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
      welcomeEl.textContent = "Welcome! Enter your OpenAI API key above, then ask me anything about this webpage.";
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
    // Small delay to ensure the popup is fully rendered
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

  async toggleSidebarMode() {
    try {
      // Store current page data for the sidebar
      if (this.currentPageData) {
        await chrome.storage.local.set({ sidebarPageData: this.currentPageData });
      }
      
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      
      // Open sidebar by creating a new tab with sidebar.html
      const sidebarUrl = chrome.runtime.getURL('sidebar.html');
      await chrome.tabs.create({ 
        url: sidebarUrl,
        index: tab.index + 1
      });
      
      // Close the popup
      window.close();
    } catch (error) {
      console.error('Error opening sidebar:', error);
      this.setStatus('Error opening sidebar mode');
    }
  }
}

document.addEventListener("DOMContentLoaded", () => {
  new PageChatAssistant();
});
