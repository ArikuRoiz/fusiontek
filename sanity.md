# Submit feedback
curl -s -X POST http://localhost:3000/feedback \
  -H "Content-Type: application/json" \
  -d '{"content": "The app is great but I really need dark mode and better search filters."}' | jq

# Check status (copy the id from above)
curl -s http://localhost:3000/feedback/<id> | jq

# List all (poll this until status becomes DONE)
curl -s http://localhost:3000/feedback | jq

# Test deduplication (should return 409)
curl -s -X POST http://localhost:3000/feedback \
  -H "Content-Type: application/json" \
  -d '{"content": "The app is great but I really need dark mode and better search filters."}' | jq