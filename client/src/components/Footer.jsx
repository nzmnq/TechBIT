import React from 'react';

function Footer() {
  return (
    <footer className="footer">
      <div className="container footer-inner">
        <div>
          <strong style={{ color: '#ffffff' }}>TechBIT</strong> © 2026
          <div style={{ fontSize: '13px', color: '#94a3b8', marginTop: '4px' }}>
            Датчики контролю гальмівних колодок та ходової для вантажного й легкового транспорту.
          </div>
        </div>

        <div className="social-buttons">
          <a
            href="https://instagram.com"
            target="_blank"
            rel="noreferrer"
            className="social-btn"
            title="Instagram TechBIT"
          >
            Instagram
          </a>
          <a
            href="https://t.me"
            target="_blank"
            rel="noreferrer"
            className="social-btn"
            title="Telegram TechBIT"
          >
            Telegram
          </a>
          <a
            href="mailto:nedovizt26@gmail.com"
            className="social-btn"
            title="Написати на пошту TechBIT"
          >
            Email
          </a>
        </div>
      </div>
    </footer>
  );
}

export default Footer;
