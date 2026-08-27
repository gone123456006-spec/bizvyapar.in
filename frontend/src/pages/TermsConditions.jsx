import { useNavigate } from 'react-router-dom'
import './TermsConditions.css'

export default function TermsConditions() {
  const navigate = useNavigate()

  function handleClose() {
    const idx = window.history.state?.idx
    if (typeof idx === 'number' && idx > 0) {
      navigate(-1)
      return
    }
    navigate('/')
  }

  return (
    <div className="terms-page">
      <header className="terms-top">
        <button
          className="terms-close"
          type="button"
          aria-label="Close"
          onClick={handleClose}
        >
          ×
        </button>
      </header>

      <main className="terms-main">
        <h1>Premium Subscription Terms &amp; Conditions</h1>
        <p className="terms-effective">Effective Date: 25-05-2026</p>

        <p>
          These Subscription Terms &amp; Conditions govern the purchase and use
          of Premium Memberships offered through the app. By purchasing any
          subscription, you agree to these terms.
        </p>

        <h2>1. Subscription Plans</h2>
        <p>The app offers the following premium membership plans:</p>
        <ul>
          <li>Monthly</li>
          <li>Quarterly (3 Months)</li>
          <li>Annual (12 Months)</li>
        </ul>
        <p>
          Each plan provides premium features according to the selected
          membership tier (Gold, Platinum, or Black).
        </p>

        <h2>2. Billing and Payment</h2>
        <ul>
          <li>
            Subscription fees are charged in advance at the beginning of each
            billing cycle.
          </li>
          <li>
            Payments are processed through the applicable app store or payment
            provider.
          </li>
          <li>Taxes may be applied where required by law.</li>
          <li>
            Prices may vary depending on your country, currency, platform, or
            promotional offers.
          </li>
        </ul>

        <h2>3. Automatic Renewal</h2>
        <ul>
          <li>
            All subscriptions automatically renew at the end of the selected
            billing period unless auto-renewal is disabled before the renewal
            date.
          </li>
          <li>
            The renewal amount will be charged using your selected payment
            method.
          </li>
          <li>
            You are responsible for managing or canceling your subscription
            prior to renewal if you do not wish to continue.
          </li>
        </ul>

        <h2>4. Cancellation</h2>
        <ul>
          <li>
            You may cancel your subscription at any time through your account
            settings or the platform where the subscription was purchased.
          </li>
          <li>Cancellation prevents future renewals.</li>
          <li>
            Premium benefits remain active until the end of the current billing
            period.
          </li>
        </ul>

        <h2>5. Refund Policy</h2>
        <ul>
          <li>Subscription payments are generally non-refundable.</li>
          <li>
            No partial refunds are provided for unused subscription periods.
          </li>
          <li>
            Refund requests are handled in accordance with the policies of the
            platform through which the purchase was made, unless otherwise
            required by applicable law.
          </li>
        </ul>

        <h2>6. Promotional Offers</h2>
        <ul>
          <li>
            Introductory pricing, discounts, coupons, and promotional offers are
            valid only for the specified period.
          </li>
          <li>
            Promotional offers cannot be combined unless explicitly stated.
          </li>
          <li>
            Standard subscription pricing will apply after the promotional
            period unless otherwise specified.
          </li>
        </ul>

        <h2>7. Price Changes</h2>
        <p>
          We reserve the right to modify subscription prices at any time. Any
          changes will apply to future billing cycles in accordance with
          applicable law and platform policies.
        </p>

        <h2>8. User Responsibilities</h2>
        <p>Premium members must:</p>
        <ul>
          <li>Provide accurate payment information.</li>
          <li>Use the subscription for personal use only.</li>
          <li>Follow all community guidelines.</li>
          <li>Comply with the app’s Terms of Service.</li>
        </ul>

        <h2>9. Prohibited Activities</h2>
        <p>Users must not:</p>
        <ul>
          <li>Share, sell, rent, or transfer their subscription.</li>
          <li>
            Use bots, automation tools, fake profiles, or unauthorized software.
          </li>
          <li>Harass, threaten, impersonate, or abuse other users.</li>
          <li>
            Attempt to bypass payment systems or access premium features without
            authorization.
          </li>
          <li>Engage in fraudulent or illegal activities.</li>
        </ul>
        <p>
          Violation of these rules may result in suspension or permanent
          termination of the account without refund.
        </p>

        <h2>10. Suspension or Termination</h2>
        <p>
          We reserve the right to suspend or terminate any premium subscription
          if:
        </p>
        <ul>
          <li>Payment fails or is reversed.</li>
          <li>Fraudulent activity is detected.</li>
          <li>
            The user violates our Terms of Service or Community Guidelines.
          </li>
          <li>
            The account poses a security risk to the platform or other users.
          </li>
        </ul>

        <h2>11. Availability of Services</h2>
        <p>
          While we strive to provide uninterrupted service, we do not guarantee
          that premium features will always be available. Temporary interruptions
          may occur due to maintenance, updates, technical issues, or other
          circumstances beyond our control.
        </p>

        <h2>12. Changes to Features</h2>
        <p>
          We may add, modify, replace, or discontinue premium features to improve
          the service. Such changes do not automatically entitle users to a
          refund.
        </p>

        <h2>13. Privacy</h2>
        <p>
          Your personal information is handled in accordance with our Privacy
          Policy. Payment information is processed securely by authorized payment
          providers and is not stored by us unless explicitly stated.
        </p>

        <h2>14. Limitation of Liability</h2>
        <p>
          To the maximum extent permitted by law, the app shall not be liable for
          any indirect, incidental, consequential, or special damages arising
          from the use of premium subscriptions.
        </p>

        <h2>15. Governing Law</h2>
        <p>
          These Subscription Terms &amp; Conditions are governed by the laws
          applicable in the jurisdiction where the app operator is established,
          unless otherwise required by local law.
        </p>

        <h2>16. Contact Us</h2>
        <p>
          If you have any questions regarding your subscription, billing, or
          premium features, please contact our customer support through the
          contact details provided within the app or on our official website.
        </p>

        <p className="terms-closing">
          By purchasing or renewing a Premium Membership, you acknowledge that
          you have read, understood, and agreed to these Subscription Terms &amp;
          Conditions.
        </p>
      </main>
    </div>
  )
}
