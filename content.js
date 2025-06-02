function extractPageText() {
  try {
    // Handle pages that might not have a body yet
    if (!document.body) {
      return {
        text: document.title || "Page loading...",
        title: document.title || "Untitled",
        url: window.location.href,
      };
    }

    const elementsToSkip = [
      "script",
      "style",
      "nav",
      "header",
      "footer",
      "aside",
      "noscript",
    ];
    const skipSelector = elementsToSkip.join(", ");

    // Try multiple extraction methods
    let extractedText = "";

    // Method 1: TreeWalker (primary)
    try {
      const walker = document.createTreeWalker(
        document.body,
        NodeFilter.SHOW_TEXT,
        {
          acceptNode: function (node) {
            const parent = node.parentElement;
            if (!parent) return NodeFilter.FILTER_REJECT;

            if (parent.closest(skipSelector)) {
              return NodeFilter.FILTER_REJECT;
            }

            try {
              const styles = getComputedStyle(parent);
              if (
                styles.display === "none" ||
                styles.visibility === "hidden" ||
                styles.opacity === "0"
              ) {
                return NodeFilter.FILTER_REJECT;
              }
            } catch (e) {
              // Skip if we can't get computed styles
            }

            const text = node.textContent.trim();
            if (text.length < 2) return NodeFilter.FILTER_REJECT;

            return NodeFilter.FILTER_ACCEPT;
          },
        }
      );

      let textNodes = [];
      let node;

      while ((node = walker.nextNode())) {
        textNodes.push(node.textContent.trim());
      }

      extractedText = textNodes.join(" ").replace(/\s+/g, " ").trim();
    } catch (e) {
      console.warn("TreeWalker failed, trying fallback method");
    }

    // Method 2: Fallback - simple text extraction
    if (!extractedText || extractedText.length < 50) {
      const elements = document.body.querySelectorAll(
        "p, h1, h2, h3, h4, h5, h6, div, span, article, section, main"
      );
      const texts = [];

      elements.forEach((el) => {
        if (!el.closest(skipSelector)) {
          const text = el.textContent.trim();
          if (text.length > 10) {
            texts.push(text);
          }
        }
      });

      extractedText = texts.join(" ").replace(/\s+/g, " ").trim();
    }

    // Method 3: Last resort - innerText
    if (!extractedText || extractedText.length < 20) {
      extractedText =
        document.body.innerText || document.body.textContent || "";
    }

    // Limit text length
    if (extractedText.length > 15000) {
      extractedText = extractedText.substring(0, 15000) + "...";
    }

    return {
      text: extractedText || "No readable content found on this page.",
      title: document.title || "Untitled",
      url: window.location.href,
    };
  } catch (error) {
    console.error("Text extraction failed:", error);
    return {
      text: "Error extracting page content.",
      title: document.title || "Error",
      url: window.location.href,
    };
  }
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "extractText") {
    const pageData = extractPageText();
    sendResponse(pageData);
  }
  return true;
});
