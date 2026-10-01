const fs = require('fs');
const vm = require('vm');
const path = require('path');

const apiCode = fs.readFileSync(path.resolve(__dirname, '../../frontend/js/api.js'), 'utf8');
const authCode = fs.readFileSync(path.resolve(__dirname, '../../frontend/js/auth.js'), 'utf8');

const storage = {
  access_token: 'valid_mock_token',
  user: JSON.stringify({
    id: 1,
    username: 'admin@gmail.com',
    email: 'admin@gmail.com',
    full_name: 'System Administrator',
    roles: ['SYSTEM_ADMIN']
  })
};

const sandbox = {
  window: {
    location: {
      pathname: '/admin/dashboard.html',
      href: 'http://localhost:3000/admin/dashboard.html'
    }
  },
  document: {
    querySelector: (sel) => {
      console.log('querySelector:', sel);
      return {
        querySelector: (s) => null,
        insertBefore: () => {},
        appendChild: () => {},
        parentNode: { insertBefore: () => {} },
        firstChild: null
      };
    },
    getElementById: (id) => {
      console.log('getElementById:', id);
      return {
        innerHTML: '',
        innerText: '',
        textContent: '',
        classList: { add: () => {}, remove: () => {}, toggle: () => {} },
        appendChild: () => {}
      };
    },
    createElement: (tag) => {
      console.log('createElement:', tag);
      return {
        innerHTML: '',
        innerText: '',
        setAttribute: () => {},
        classList: { add: () => {} }
      };
    },
    body: {
      appendChild: () => {},
      insertAdjacentHTML: (pos, html) => {
        console.log('body.insertAdjacentHTML at', pos);
      }
    },
    addEventListener: () => {}
  },
  localStorage: {
    getItem: (k) => storage[k] || null,
    setItem: (k, v) => storage[k] = v,
    removeItem: (k) => delete storage[k]
  },
  alert: console.log,
  console: console
};

vm.createContext(sandbox);

try {
  vm.runInContext(apiCode, sandbox);
  console.log('✓ api.js loaded successfully');
  vm.runInContext(authCode, sandbox);
  console.log('✓ auth.js loaded successfully');
  vm.runInContext('guardRoute(["SYSTEM_ADMIN"]);', sandbox);
  console.log('✓ guardRoute(["SYSTEM_ADMIN"]) executed successfully');
} catch (e) {
  console.error('CRITICAL ERROR in auth/api JS execution:', e);
}
