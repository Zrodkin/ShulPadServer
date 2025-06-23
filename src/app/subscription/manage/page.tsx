// src/app/subscription/manage/page.tsx - FIXED VERSION
'use client'

import { useEffect, useState, Suspense } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import Head from 'next/head'

interface SubscriptionDetails {
  id: string
  status: string
  plan_type: string
  device_count: number
  total_price: number
  next_billing_date: string
  card_last_four: string
}

function ManagePageContent() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const orgId = searchParams.get('org_id') || 'default'
  
  const [subscription, setSubscription] = useState<SubscriptionDetails | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  
  useEffect(() => {
    fetchSubscriptionDetails()
  }, [orgId])
  
  async function fetchSubscriptionDetails() {
    try {
      const response = await fetch(`/api/subscriptions/status?organization_id=${orgId}`)
      if (!response.ok) throw new Error('Failed to fetch subscription')
      
      const data = await response.json()
      if (data.subscription) {
        setSubscription(data.subscription)
      } else {
        setError('No active subscription found')
      }
    } catch (err) {
      setError('Failed to load subscription details')
    } finally {
      setIsLoading(false)
    }
  }
  
  async function handleCancelSubscription() {
    if (!confirm('Are you sure you want to cancel your subscription?')) return
    
    try {
      const response = await fetch('/api/subscriptions/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ organization_id: orgId })
      })
      
      if (!response.ok) throw new Error('Failed to cancel subscription')
      
      alert('Subscription cancelled successfully')
      router.push(`shulpad://subscription/cancelled?org_id=${orgId}`)
    } catch (err) {
      alert('Failed to cancel subscription')
    }
  }
  
  if (isLoading) {
    return (
      <>
        <Head>
          <title>ShulPad Subscription - Loading</title>
          <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
          <meta httpEquiv="Content-Type" content="text/html; charset=UTF-8" />
          <link rel="stylesheet" href="/safari-fallback.css" />
        </Head>
        <div style={{
          minHeight: '100vh',
          backgroundColor: '#f9fafb',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center'
        }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{
              animation: 'spin 1s linear infinite',
              borderRadius: '50%',
              height: '48px',
              width: '48px',
              borderTop: '2px solid #2563eb',
              borderRight: '2px solid transparent',
              margin: '0 auto'
            }}></div>
            <p style={{ marginTop: '16px', color: '#6b7280' }}>Loading subscription details...</p>
          </div>
        </div>
      </>
    )
  }
  
  if (error || !subscription) {
    return (
      <>
        <Head>
          <title>ShulPad Subscription - No Active Subscription</title>
          <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
          <meta httpEquiv="Content-Type" content="text/html; charset=UTF-8" />
          <link rel="stylesheet" href="/safari-fallback.css" />
        </Head>
        <div style={{
          minHeight: '100vh',
          backgroundColor: '#f9fafb',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '16px'
        }}>
          <div style={{ maxWidth: '448px', width: '100%', textAlign: 'center' }}>
            <h1 style={{
              fontSize: '24px',
              fontWeight: 'bold',
              color: '#111827',
              marginBottom: '16px'
            }}>No Active Subscription</h1>
            <p style={{
              color: '#6b7280',
              marginBottom: '32px'
            }}>{error || 'You don\'t have an active subscription.'}</p>
            <a
              href={`/subscription/checkout?org_id=${orgId}`}
              style={{
                display: 'inline-block',
                padding: '12px 24px',
                backgroundColor: '#2563eb',
                color: 'white',
                borderRadius: '8px',
                textDecoration: 'none',
                fontWeight: '500'
              }}
            >
              Subscribe Now
            </a>
          </div>
        </div>
      </>
    )
  }
  
  return (
    <>
      <Head>
        <title>ShulPad Subscription - Manage</title>
        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
        <meta httpEquiv="Content-Type" content="text/html; charset=UTF-8" />
        <meta name="format-detection" content="telephone=no" />
        <link rel="stylesheet" href="/safari-fallback.css" />
        <style dangerouslySetInnerHTML={{
          __html: `
            .status-badge {
              padding: 4px 8px;
              border-radius: 9999px;
              font-size: 12px;
              font-weight: 600;
              text-transform: uppercase;
            }
            .status-active {
              background-color: #dcfce7;
              color: #166534;
            }
            .status-inactive {
              background-color: #f3f4f6;
              color: #374151;
            }
            .detail-row {
              display: flex;
              justify-content: space-between;
              padding: 8px 0;
              border-bottom: 1px solid #f3f4f6;
            }
            .detail-row:last-child {
              border-bottom: none;
            }
            .detail-label {
              color: #6b7280;
            }
            .detail-value {
              font-weight: 500;
            }
            .payment-method {
              display: flex;
              align-items: center;
              justify-content: space-between;
            }
            .card-icon {
              width: 48px;
              height: 32px;
              background-color: #f3f4f6;
              border-radius: 4px;
              display: flex;
              align-items: center;
              justify-content: center;
              font-size: 12px;
              font-family: monospace;
              margin-right: 12px;
            }
            .btn-secondary {
              background-color: white;
              color: #dc2626;
              border: 1px solid #dc2626;
              padding: 8px 16px;
              border-radius: 6px;
              cursor: pointer;
              font-size: 16px;
              font-weight: 500;
              width: 100%;
              margin-top: 12px;
            }
            .btn-secondary:hover {
              background-color: #fef2f2;
            }
            .actions-section {
              padding: 24px;
              border-top: 1px solid #e5e7eb;
            }
          `
        }} />
      </Head>
      
      <div className="min-h-screen" style={{
        minHeight: '100vh',
        backgroundColor: '#f9fafb',
        padding: '48px 16px'
      }}>
        <div style={{ maxWidth: '448px', margin: '0 auto' }}>
          <h1 style={{
            fontSize: '30px',
            fontWeight: 'bold',
            color: '#111827',
            marginBottom: '32px',
            textAlign: 'center'
          }}>
            Manage Subscription
          </h1>
          
          <div style={{
            backgroundColor: 'white',
            borderRadius: '8px',
            boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.1)',
            overflow: 'hidden'
          }}>
            {/* Subscription Status */}
            <div style={{ padding: '24px' }}>
              <h2 style={{
                fontSize: '18px',
                fontWeight: '600',
                marginBottom: '16px'
              }}>Subscription Details</h2>
              
              <div>
                <div className="detail-row">
                  <span className="detail-label">Status</span>
                  <span className={`status-badge ${subscription.status === 'active' ? 'status-active' : 'status-inactive'}`}>
                    {subscription.status}
                  </span>
                </div>
                <div className="detail-row">
                  <span className="detail-label">Plan</span>
                  <span className="detail-value" style={{ textTransform: 'capitalize' }}>
                    {subscription.plan_type}
                  </span>
                </div>
                <div className="detail-row">
                  <span className="detail-label">Devices</span>
                  <span className="detail-value">{subscription.device_count}</span>
                </div>
                <div className="detail-row">
                  <span className="detail-label">Price</span>
                  <span className="detail-value">
                    ${subscription.total_price}/{subscription.plan_type === 'monthly' ? 'month' : 'year'}
                  </span>
                </div>
                <div className="detail-row">
                  <span className="detail-label">Next Billing</span>
                  <span className="detail-value">
                    {new Date(subscription.next_billing_date).toLocaleDateString()}
                  </span>
                </div>
              </div>
            </div>
            
            {/* Payment Method */}
            <div style={{
              padding: '24px',
              borderTop: '1px solid #e5e7eb'
            }}>
              <h2 style={{
                fontSize: '18px',
                fontWeight: '600',
                marginBottom: '16px'
              }}>Payment Method</h2>
              <div className="payment-method">
                <div style={{ display: 'flex', alignItems: 'center' }}>
                  <div className="card-icon">****</div>
                  <span style={{ color: '#6b7280' }}>
                    Card ending in {subscription.card_last_four}
                  </span>
                </div>
                <button style={{
                  color: '#2563eb',
                  background: 'none',
                  border: 'none',
                  fontSize: '14px',
                  cursor: 'pointer',
                  textDecoration: 'underline'
                }}>
                  Update
                </button>
              </div>
            </div>
            
            {/* Actions */}
            <div className="actions-section">
              <button
                onClick={() => router.push(`/subscription/checkout?org_id=${orgId}&plan=${subscription.plan_type}&devices=${subscription.device_count}`)}
                className="btn btn-primary"
                style={{
                  width: '100%',
                  padding: '12px 16px',
                  backgroundColor: '#2563eb',
                  color: 'white',
                  border: 'none',
                  borderRadius: '6px',
                  fontSize: '16px',
                  fontWeight: '500',
                  cursor: 'pointer'
                }}
              >
                Change Plan
              </button>
              <button
                onClick={handleCancelSubscription}
                className="btn-secondary"
              >
                Cancel Subscription
              </button>
            </div>
          </div>
          
          {/* Return to App */}
          <div style={{
            marginTop: '32px',
            textAlign: 'center'
          }}>
            <a
              href={`shulpad://subscription/manage?org_id=${orgId}`}
              style={{
                color: '#2563eb',
                textDecoration: 'underline'
              }}
            >
              Return to ShulPad
            </a>
          </div>
        </div>
      </div>
    </>
  )
}

export default function ManagePage() {
  return (
    <Suspense fallback={
      <div style={{
        minHeight: '100vh',
        backgroundColor: '#f9fafb',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center'
      }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{
            animation: 'spin 1s linear infinite',
            borderRadius: '50%',
            height: '48px',
            width: '48px',
            borderTop: '2px solid #2563eb',
            borderRight: '2px solid transparent',
            margin: '0 auto'
          }}></div>
          <p style={{ marginTop: '16px', color: '#6b7280' }}>Loading...</p>
        </div>
      </div>
    }>
      <ManagePageContent />
    </Suspense>
  )
}