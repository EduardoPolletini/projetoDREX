import { api } from './api.js';

const form = document.getElementById('bankForm');
const feedback = document.getElementById('bankError');
const pin = document.getElementById('pin');
form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = form.querySelector('button');
  button.disabled = true;
  feedback.hidden = true;
  try {
    // Valida o PIN fictício e recebe a URL de retorno.
    const result = await api('bank/authorize', 'POST', {
      state: new URLSearchParams(location.search).get('state'),
      pin: pin.value,
    });
    location.replace(result.returnUrl);
  } catch (error) {
    feedback.textContent = error.message;
    feedback.hidden = false;
    button.disabled = false;
    pin.focus();
  } finally {
    pin.value = '';
  }
});
