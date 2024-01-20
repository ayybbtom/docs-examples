async function createOrderCallback() {
  try {
    const response = await fetch("/api/orders", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      // use the "body" param to optionally pass additional order information
      // like product ids and quantities
      body: JSON.stringify({
        cart: [
          {
            id: "YOUR_PRODUCT_ID",
            quantity: "YOUR_PRODUCT_QUANTITY",
          },
        ],
      }),
    });

    const orderData = await response.json();

    if (orderData.id) {
      return orderData.id;
    } else {
      const errorDetail = orderData?.details?.[0];
      const errorMessage = errorDetail
        ? `${errorDetail.issue} ${errorDetail.description} (${orderData.debug_id})`
        : JSON.stringify(orderData);

      throw new Error(errorMessage);
    }
  } catch (error) {
    console.error(error);
    resultMessage(`Could not initiate PayPal Checkout...<br><br>${error}`);
  }
}

async function onApproveCallback(data, actions) {
  try {
    const response = await fetch(`/api/orders/${data.orderID}/capture`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
    });

    const orderData = await response.json();
    // Three cases to handle:
    //   (1) Recoverable INSTRUMENT_DECLINED -> call actions.restart()
    //   (2) Other non-recoverable errors -> Show a failure message
    //   (3) Successful transaction -> Show confirmation or thank you message

    const transaction =
      orderData?.purchase_units?.[0]?.payments?.captures?.[0] ||
      orderData?.purchase_units?.[0]?.payments?.authorizations?.[0];
    const errorDetail = orderData?.details?.[0];

    // this actions.restart() behavior only applies to the Buttons component
    if (errorDetail?.issue === "INSTRUMENT_DECLINED" && !data.card && actions) {
      // (1) Recoverable INSTRUMENT_DECLINED -> call actions.restart()
      // recoverable state, per https://developer.paypal.com/docs/checkout/standard/customize/handle-funding-failures/
      return actions.restart();
    } else if (
      errorDetail ||
      !transaction ||
      transaction.status === "DECLINED"
    ) {
      // (2) Other non-recoverable errors -> Show a failure message
      let errorMessage;
      if (transaction) {
        errorMessage = `Transaction ${transaction.status}: ${transaction.id}`;
      } else if (errorDetail) {
        errorMessage = `${errorDetail.description} (${orderData.debug_id})`;
      } else {
        errorMessage = JSON.stringify(orderData);
      }

      throw new Error(errorMessage);
    } else {
      // (3) Successful transaction -> Show confirmation or thank you message
      // Or go to another URL:  actions.redirect('thank_you.html');
      resultMessage(
        `Transaction ${transaction.status}: ${transaction.id}<br><br>See console for all available details`,
      );
      console.log(
        "Capture result",
        orderData,
        JSON.stringify(orderData, null, 2),
      );
    }
  } catch (error) {
    console.error(error);
    resultMessage(
      `Sorry, your transaction could not be processed...<br><br>${error}`,
    );
  }
}

window.paypal
  .Buttons({
    createOrder: createOrderCallback,
    onApprove: onApproveCallback,
  })
  .render("#paypal-button-container");

const cardField = window.paypal.CardFields({
  createOrder: createOrderCallback,
  onApprove: onApproveCallback,
});

// Render each field after checking for eligibility
if (cardField.isEligible()) {
  const nameField = cardField.NameField();
  nameField.render("#card-name-field-container");

  const numberField = cardField.NumberField();
  numberField.render("#card-number-field-container");

  const cvvField = cardField.CVVField();
  cvvField.render("#card-cvv-field-container");

  const expiryField = cardField.ExpiryField();
  expiryField.render("#card-expiry-field-container");

  // Add click listener to submit button and call the submit function on the CardField component
  document
    .getElementById("multi-card-field-button")
    .addEventListener("click", () => {
      cardField.submit().catch((error) => {
        resultMessage(
          `Sorry, your transaction could not be processed...<br><br>${error}`,
        );
      });
    });
} else {
  // Hides card fields if the merchant isn't eligible
  document.querySelector("#card-form").style = "display: none";
}

// Example function to show a result to the user. Your site's UI library can be used instead.
function resultMessage(message) {
  const container = document.querySelector("#result-message");
  container.innerHTML = message;
}

// took the below apple pay code from advanced-integration/public/app.js in https://github.com/paypal-examples/applepay/blob/main/advanced-integration/public/app.js and copy pasta the whole page

async function setupApplepay() {
  const applepay = paypal.Applepay();
    const {
      isEligible,
      countryCode,
      currencyCode,
      merchantCapabilities,
      supportedNetworks,
    } = await  applepay.config();

  if (!isEligible) {
    throw new Error("applepay is not eligible");
  }

  document.getElementById("applepay-container").innerHTML =
    '<apple-pay-button id="btn-appl" buttonstyle="black" type="buy" locale="en">';

  document.getElementById("btn-appl").addEventListener("click", onClick);

  async function onClick() {
    console.log({ merchantCapabilities, currencyCode, supportedNetworks })

    const paymentRequest = {
      countryCode,
      currencyCode: 'USD',
      merchantCapabilities,
      supportedNetworks,
      requiredBillingContactFields: [
        "name",
        "phone",
        "email",
        "postalAddress",
      ],
      requiredShippingContactFields: [
      ],
      total: {
        label: "Demo (Card is not charged)",
        amount: "10.00",
        type: "final",
      },
    };

    // eslint-disable-next-line no-undef
    let session = new ApplePaySession(4, paymentRequest);

    session.onvalidatemerchant = (event) => {
      applepay
        .validateMerchant({
          validationUrl: event.validationURL,
        })
        .then((payload) => {
          session.completeMerchantValidation(payload.merchantSession);
        })
        .catch((err) => {
          console.error(err);
          session.abort();
        });
    };

    session.onpaymentmethodselected = () => {
      session.completePaymentMethodSelection({
        newTotal: paymentRequest.total,
      });
    };

    session.onpaymentauthorized = async (event) => {
      try {
        /* Create Order on the Server Side */
        const orderResponse = await fetch(`/api/orders`,{
          method:'POST',
          headers : {
            'Content-Type': 'application/json'
          }
        })
        if(!orderResponse.ok) {
            throw new Error("error creating order")
        }

        const { id } = await orderResponse.json()
        console.log({ id })
        /**
         * Confirm Payment 
         */
        await applepay.confirmOrder({ orderId: id, token: event.payment.token, billingContact: event.payment.billingContact , shippingContact: event.payment.shippingContact });

        /*
        * Capture order (must currently be made on server)
        */
        await fetch(`/api/orders/${id}/capture`, {
          method: 'POST',
        });

        session.completePayment({
          status: window.ApplePaySession.STATUS_SUCCESS,
        });
      } catch (err) {
        console.error(err);
        session.completePayment({
          status: window.ApplePaySession.STATUS_FAILURE,
        });
      }
    };

    session.oncancel  = () => {
      console.log("Apple Pay Cancelled !!")
    }

    session.begin();
  }
}

document.addEventListener("DOMContentLoaded", () => {

  // eslint-disable-next-line no-undef
  if(ApplePaySession?.supportsVersion(4) && ApplePaySession?.canMakePayments()) {
    setupApplepay().catch(console.error);
  }
});