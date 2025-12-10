# API Setup Instructions

## Required API Keys

This application uses two external APIs for route optimization:

### 1. Omelet Routing Engine API
- **Purpose**: Vehicle Routing Problem (VRP) optimization
- **Website**: https://routing.oaasis.cc
- **Documentation**: Check the Omelet API documentation for registration

### 2. iNavi Maps API
- **Purpose**: Distance matrix calculation and road geometry
- **Website**: https://www.inavi.com
- **Documentation**: Check iNavi developer portal for API key registration

## Setup Steps

1. **Create a `.env` file** in the `frontend` directory:
   ```bash
   cd frontend
   touch .env
   ```

2. **Add your API keys** to the `.env` file:
   ```env
   VITE_OMELET_API_KEY=your_omelet_api_key_here
   VITE_INAVI_API_KEY=your_inavi_api_key_here
   ```

3. **Restart the development server** after adding the keys:
   ```bash
   npm run dev
   ```

## Fallback Behavior

The application has built-in fallback mechanisms:

- **iNavi API unavailable**: Falls back to Euclidean distance calculation
- **Omelet API unavailable**: Falls back to mock route generation
- **No API keys set**: Uses fallback modes automatically

This means the application will still work (with reduced accuracy) even without API keys, using:
- Euclidean (straight-line) distances instead of road network distances
- Mock greedy routing instead of optimized VRP solutions

## Troubleshooting

### Error: "Missing distance_matrix or duration_matrix in iNavi response"
- Check that your `VITE_INAVI_API_KEY` is valid
- The app will automatically fall back to Euclidean distance calculation
- Check the console for detailed error messages

### Error: "Omelet API failed: 422"
- Check that your `VITE_OMELET_API_KEY` is valid
- Verify the request format matches Omelet API requirements
- The app will automatically fall back to mock route generation

### API Keys Not Loading
- Ensure the `.env` file is in the `frontend` directory (not the root)
- Environment variable names must start with `VITE_` for Vite to expose them
- Restart the dev server after changing `.env` file

