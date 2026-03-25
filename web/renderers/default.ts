export function renderDefault(data: unknown, container: HTMLElement): void {
  container.innerHTML = `
    <div class="default-result">
      <pre>${JSON.stringify(data, null, 2)}</pre>
    </div>
  `;
}
