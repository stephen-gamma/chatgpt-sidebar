// Simple markdown parser for the chat assistant
class MarkdownParser {
  static parse(text) {
    if (!text || typeof text !== 'string') return '';
    
    let html = text;
    
    // Escape HTML first to prevent XSS
    html = html.replace(/&/g, '&amp;')
              .replace(/</g, '&lt;')
              .replace(/>/g, '&gt;');
    
    // Code blocks (```code```)
    html = html.replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>');
    
    // Inline code (`code`)
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
    
    // Process lists BEFORE line break handling
    // Unordered lists (- or *)
    html = html.replace(/^[-*] (.*)$/gm, '<li>$1</li>');
    
    // Ordered lists
    html = html.replace(/^\d+\. (.*)$/gm, '<li>$1</li>');
    
    // Wrap consecutive list items in ul/ol tags
    html = html.replace(/(<li>.*<\/li>\s*)+/gs, (match) => {
      return '<ul>' + match + '</ul>';
    });
    
    // Headers (# ## ###)
    html = html.replace(/^### (.*$)/gim, '<h3>$1</h3>');
    html = html.replace(/^## (.*$)/gim, '<h2>$1</h2>');
    html = html.replace(/^# (.*$)/gim, '<h1>$1</h1>');
    
    // Bold (**text** or __text__)
    html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/__(.*?)__/g, '<strong>$1</strong>');
    
    // Italic (*text* or _text_) - but not if it's part of a list
    html = html.replace(/(?<!^[-*] )\*([^*]+)\*/g, '<em>$1</em>');
    html = html.replace(/_([^_]+)_/g, '<em>$1</em>');
    
    // Strikethrough (~~text~~)
    html = html.replace(/~~(.*?)~~/g, '<del>$1</del>');
    
    // Links [text](url)
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
    
    // Handle paragraphs and line breaks
    // Split into paragraphs on double newlines
    const paragraphs = html.split(/\n\s*\n/);
    html = paragraphs.map(p => {
      // Don't wrap lists, headers, or code blocks in paragraphs
      if (p.startsWith('<ul>') || p.startsWith('<ol>') || p.startsWith('<h') || p.startsWith('<pre>')) {
        return p;
      }
      // Convert single newlines to spaces within paragraphs
      p = p.replace(/\n/g, ' ');
      return p.trim() ? '<p>' + p.trim() + '</p>' : '';
    }).filter(p => p).join('');
    
    return html;
  }
}