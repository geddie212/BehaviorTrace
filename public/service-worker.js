self.addEventListener("push", event => {
  const data = event.data.json();

  event.waitUntil(
    self.registration.showNotification("Status Check", {
      body: `Do you still feel ${data.label_name}?`,
      data: {
        state_id: data.state_id
      }
    })
  );
});

self.addEventListener("notificationclick", event => {
  event.notification.close();
  event.waitUntil(
    clients.openWindow("/trace")
  );
});
