const form = document.getElementById('bankForm');
const feedback = document.getElementById('bankError');
const pin = document.getElementById('pin');
form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = form.querySelector('button');
  button.disabled = true;
  feedback.hidden = true;
  try {
    const response = await fetch('/api/bank/authorize', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + (sessionStorage.getItem('drexToken') ?? ''),
      },
      body: JSON.stringify({ state: new URLSearchParams(location.search).get('state'), pin: pin.value }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error);
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
