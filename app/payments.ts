export async function paymentApi(body: unknown) {
  const r = await fetch("/api/payments", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = await r.json();
  if (!r.ok)
    throw new Error(result.error || "결제 요청을 처리하지 못했습니다.");
  return result;
}
let sdk: Promise<void> | undefined;
function loadSdk() {
  if (!sdk)
    sdk = new Promise<void>((resolve, reject) => {
      const el = document.createElement("script");
      el.src = "https://js.tosspayments.com/v2/standard";
      el.onload = () => resolve();
      el.onerror = () => {
        sdk = undefined;
        el.remove();
        reject(new Error("결제 창을 불러오지 못했습니다. 다시 시도해 주세요."));
      };
      document.head.append(el);
    });
  return sdk;
}
export async function checkout(id: string) {
  const data = await paymentApi({ action: "checkout", id });
  await loadSdk();
  await (window as any)
    .TossPayments(data.clientKey)
    .payment({ customerKey: data.customerKey })
    .requestPayment({
      method: "CARD",
      amount: { currency: "KRW", value: data.amount },
      orderId: data.orderId,
      orderName: data.orderName,
      successUrl: data.successUrl,
      failUrl: data.failUrl,
    });
}
