import React from 'react';

function Footer() {
  return (
    <footer className="footer">
      <div className="container footer-inner">
        <div>
          <strong style={{ color: '#ffffff' }}>TechBIT</strong> © 2026 — B2B IoT + SaaS Fleet Safety
          <div style={{ fontSize: '12.5px', color: '#94a3b8', marginTop: '4px' }}>
            Предиктивний та аварійний контроль ступиць, підшипників і гальм вантажівок та причепів (24V DC • SI • UTC).
          </div>
        </div>

        <div className="social-buttons">
          <a href="https://instagram.com" target="_blank" rel="noreferrer" className="social-btn">
            Instagram
          </a>
          <a href="https://t.me" target="_blank" rel="noreferrer" className="social-btn">
            Telegram
          </a>
          <a href="mailto:nedovizt26@gmail.com" className="social-btn">
            Email
          </a>
        </div>
      </div>
    </footer>
  );
}

export default Footer;
