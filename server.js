const express = require('express');
const mongoose = require('mongoose');
const multer = require('multer');
const sharp = require('sharp');
const path = require('path');
const fs = require('fs');
const cors = require('cors');

const app = express();

// ========== Middleware ==========
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ========== Serve Static Files ==========
// Serve HTML files from root directory
app.use(express.static(__dirname));

// IMPORTANT: Serve uploaded files with proper path
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// ========== Create uploads directory if it doesn't exist ==========
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
    console.log('✅ Created uploads directory at:', uploadsDir);
}

// Create a default placeholder image if it doesn't exist
const defaultImagePath = path.join(uploadsDir, 'default.jpg');
if (!fs.existsSync(defaultImagePath)) {
    // Create a simple colored placeholder image using sharp
    sharp({
        create: {
            width: 300,
            height: 200,
            channels: 4,
            background: { r: 240, g: 240, b: 240, alpha: 1 }
        }
    })
    .jpeg()
    .toFile(defaultImagePath)
    .then(() => console.log('✅ Created default placeholder image'))
    .catch(err => console.log('Could not create default image:', err.message));
}
// أضف هذه الدالة بعد تعريف الـ Product Schema
app.get('/product/:id', (req, res) => {
    res.sendFile(path.join(__dirname, 'product.html'));
});
// Get product by ID (with full URL)
app.get('/api/products/:id', async (req, res) => {
    try {
        const product = await Product.findById(req.params.id);
        if (!product) {
            return res.status(404).json({ error: 'Product not found' });
        }
        
        const prod = product.toObject();
        prod.imageUrl = product.mainImage ? 
            `http://localhost:3040/uploads/${product.mainImage}` : 
            'http://localhost:3040/uploads/default.jpg';
            
        // إضافة روابط كاملة للصور الإضافية
        if (prod.additionalImages) {
            prod.additionalImageUrls = prod.additionalImages.map(img => 
                `http://localhost:3040/uploads/${img}`
            );
        }
        
        // إضافة روابط لصور الألوان
        if (prod.colors) {
            prod.colors = prod.colors.map(color => ({
                ...color,
                imageUrls: color.images?.map(img => 
                    `http://localhost:3040/uploads/${img}`
                ) || []
            }));
        }
        
        res.json(prod);
    } catch (error) {
        console.error('Error fetching product:', error);
        res.status(500).json({ error: error.message });
    }
});
// ========== Database Connection ==========
console.log('🔄 Connecting to MongoDB...');

async function connectDB() {
    try {
        await mongoose.connect('mongodb://127.0.0.1:27017/laqualite', {
            useNewUrlParser: true,
            useUnifiedTopology: true,
            serverSelectionTimeoutMS: 5000
        });
        console.log('✅ Connected to MongoDB successfully');
        
        // Initialize seller after connection
        await initSeller();
        
    } catch (err) {
        console.error('❌ Failed to connect to MongoDB:');
        console.error(err.message);
    }
}

connectDB();

// ========== Database Schemas ==========

// Product Schema
const productSchema = new mongoose.Schema({
    name: { type: String, required: true },
    description: String,
    basePrice: { type: Number, required: true },
    mainImage: { type: String, default: 'default.jpg' },
    additionalImages: [{ type: String }], // Array for multiple images
    category: String,
    features: [{
        name: String,
        options: [{
            value: String,
            price: Number,
            stock: Number
        }]
    }],
    colors: [{
        name: String,
        hexCode: String,
        stock: Number,
        images: [{ type: String }] // Multiple images per color
    }],
    createdAt: { type: Date, default: Date.now }
});


// Order Schema
const orderSchema = new mongoose.Schema({
    orderNumber: { type: String, unique: true },
    products: [{
        productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
        name: String,
        selectedFeatures: [{
            featureName: String,
            selectedOption: String,
            additionalPrice: Number
        }],
        selectedColor: {
            name: String,
            hexCode: String
        },
        quantity: Number,
        priceAtTime: Number
    }],
    customerInfo: {
        name: { type: String, required: true },
        phone: { type: String, required: true },
        address: String,
        wilaya: { type: String, required: true },
        commune: String
    },
    deliveryCost: { type: Number, required: true },
    totalAmount: { type: Number, required: true },
    status: {
        type: String,
        enum: ['قيد المراجعة', 'تم التأكيد', 'تم الشحن', 'تم التسليم', 'ملغي', 'معاد'],
        default: 'قيد المراجعة'
    },
    notes: String,
    returnReason: String,
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});

// Generate order number before saving
orderSchema.pre('save', async function(next) {
    if (!this.orderNumber) {
        let isUnique = false;
        let orderNumber;
        
        while (!isUnique) {
            orderNumber = Math.floor(100000 + Math.random() * 900000).toString();
            const existingOrder = await mongoose.model('Order').findOne({ orderNumber });
            if (!existingOrder) {
                isUnique = true;
            }
        }
        
        this.orderNumber = orderNumber;
    }
    next();
});

// Seller Schema
const sellerSchema = new mongoose.Schema({
    username: { type: String, default: 'admin' },
    password: { type: String, default: '123456' }
});

const Product = mongoose.model('Product', productSchema);
const Order = mongoose.model('Order', orderSchema);
const Seller = mongoose.model('Seller', sellerSchema);

// ========== Initialize Seller ==========
async function initSeller() {
    try {
        const sellerExists = await Seller.findOne();
        if (!sellerExists) {
            await Seller.create({ username: 'admin', password: '123456' });
            console.log('✅ Created default seller account: admin / 123456');
        }
    } catch (error) {
        console.error('❌ Error initializing seller:', error.message);
    }
}

// ========== Image Upload Configuration ==========

// Configure multer for disk storage instead of memory (better for images)
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, uploadsDir);
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const ext = path.extname(file.originalname);
        cb(null, file.fieldname + '-' + uniqueSuffix + ext);
    }
});

const upload = multer({
    storage: storage,
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
    fileFilter: (req, file, cb) => {
        const allowedTypes = /jpeg|jpg|png|gif|webp/;
        const mimetype = allowedTypes.test(file.mimetype);
        const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());

        if (mimetype && extname) {
            return cb(null, true);
        } else {
            cb(new Error('Only image files are allowed'));
        }
    }
});

// ========== API Routes ==========

// Root endpoint
app.get('/', (req, res) => {
    res.redirect('/buyer.html');
});
// Get favicon
app.get('/favicon.ico', (req, res) => {
    res.sendFile(path.join(__dirname, 'laqualite.png'));
});

// Serve seller.html
app.get('/seller.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'seller.html'));
});

// Serve buyer.html
app.get('/buyer.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'buyer.html'));
});

// Initialize seller
app.get('/api/init-seller', async (req, res) => {
    try {
        const sellerExists = await Seller.findOne();
        if (!sellerExists) {
            await Seller.create({ username: 'admin', password: '123456' });
            res.json({ success: true, message: 'Seller account created' });
        } else {
            res.json({ success: true, message: 'Seller account already exists' });
        }
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Seller login
app.post('/api/seller/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        const seller = await Seller.findOne({ username, password });
        
        if (seller) {
            res.json({ success: true, message: 'Login successful' });
        } else {
            res.status(401).json({ success: false, message: 'Invalid username or password' });
        }
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/products', upload.fields([
    { name: 'mainImage', maxCount: 1 },
    { name: 'additionalImages', maxCount: 20 }, // Multiple additional images
    { name: 'colorImages', maxCount: 50 } // Multiple images per color
]), async (req, res) => {
    try {
        if (!req.body.productData) {
            return res.status(400).json({ error: 'Product data is required' });
        }
        
        const productData = JSON.parse(req.body.productData);
        
        // Process main image
        if (req.files && req.files['mainImage'] && req.files['mainImage'][0]) {
            const mainImageFile = req.files['mainImage'][0];
            productData.mainImage = mainImageFile.filename;
        } else {
            productData.mainImage = 'default.jpg';
        }
        
        // Process additional images
        if (req.files && req.files['additionalImages']) {
            productData.additionalImages = req.files['additionalImages'].map(file => file.filename);
        } else {
            productData.additionalImages = [];
        }
        
        // Process color images
        if (req.files && req.files['colorImages'] && productData.colors) {
            const colorImageFiles = req.files['colorImages'];
            
            // Group images by color index (you'd need to pass this from frontend)
            // For now, we'll store them in a temporary way
            productData.colors = productData.colors.map((color, index) => {
                const colorImages = colorImageFiles
                    .filter(file => file.fieldname === `colorImages[${index}]`)
                    .map(file => file.filename);
                return { ...color, images: colorImages };
            });
        }
        
        const product = new Product(productData);
        await product.save();
        
        res.status(201).json({ success: true, product });
    } catch (error) {
        console.error('Error adding product:', error);
        res.status(500).json({ error: error.message });
    }
});
// Get all products
app.get('/api/products', async (req, res) => {
    try {
        const products = await Product.find().sort({ createdAt: -1 });
        
        // Add full image URLs
        const productsWithUrls = products.map(product => {
            const prod = product.toObject();
            prod.imageUrl = product.mainImage ? 
                `http://localhost:3040/uploads/${product.mainImage}` : 
                'http://localhost:3040/uploads/default.jpg';
            return prod;
        });
        
        res.json(productsWithUrls);
    } catch (error) {
        console.error('Error fetching products:', error);
        res.status(500).json({ error: error.message });
    }
});



// Delete product
app.delete('/api/products/:id', async (req, res) => {
    try {
        const product = await Product.findById(req.params.id);
        if (!product) {
            return res.status(404).json({ error: 'Product not found' });
        }
        
        // Delete main image if it's not the default
        if (product.mainImage && product.mainImage !== 'default.jpg') {
            const imagePath = path.join(uploadsDir, product.mainImage);
            if (fs.existsSync(imagePath)) {
                fs.unlinkSync(imagePath);
                console.log(`✅ Deleted image: ${product.mainImage}`);
            }
        }
        
        await Product.findByIdAndDelete(req.params.id);
        res.json({ success: true, message: 'Product deleted' });
    } catch (error) {
        console.error('Error deleting product:', error);
        res.status(500).json({ error: error.message });
    }
});

// Create new order
app.post('/api/orders', async (req, res) => {
    try {
        const orderData = req.body;
        const order = new Order(orderData);
        await order.save();
        
        res.status(201).json({ 
            success: true, 
            orderNumber: order.orderNumber,
            message: 'Order created successfully' 
        });
    } catch (error) {
        console.error('Error creating order:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get all orders
app.get('/api/orders', async (req, res) => {
    try {
        const orders = await Order.find().sort({ createdAt: -1 });
        res.json(orders);
    } catch (error) {
        console.error('Error fetching orders:', error);
        res.status(500).json({ error: error.message });
    }
});

// Track order by number
app.get('/api/orders/track/:orderNumber', async (req, res) => {
    try {
        const order = await Order.findOne({ orderNumber: req.params.orderNumber });
        if (!order) {
            return res.status(404).json({ error: 'Order not found' });
        }
        res.json(order);
    } catch (error) {
        console.error('Error tracking order:', error);
        res.status(500).json({ error: error.message });
    }
});

// Update order status
app.patch('/api/orders/:id/status', async (req, res) => {
    try {
        const { status, returnReason } = req.body;
        
        const updateData = { 
            status, 
            updatedAt: Date.now() 
        };
        
        if (status === 'معاد' && returnReason) {
            updateData.returnReason = returnReason;
        }
        
        const order = await Order.findByIdAndUpdate(
            req.params.id,
            updateData,
            { new: true }
        );
        
        if (!order) {
            return res.status(404).json({ error: 'Order not found' });
        }
        
        res.json({ success: true, order });
    } catch (error) {
        console.error('Error updating order status:', error);
        res.status(500).json({ error: error.message });
    }
});

// Wilaya list with delivery prices
const wilayas = [
    { name: "Alger", code: "16", deliveryFast: 800.00, deliveryNormal: 500.00 },
    { name: "Oran", code: "31", deliveryFast: 800.00, deliveryNormal: 500.00 },
    { name: "Constantine", code: "25", deliveryFast: 900.00, deliveryNormal: 600.00 },
    { name: "Annaba", code: "23", deliveryFast: 800.00, deliveryNormal: 500.00 },
    { name: "Blida", code: "09", deliveryFast: 800.00, deliveryNormal: 500.00 },
    { name: "Setif", code: "19", deliveryFast: 850.00, deliveryNormal: 500.00 },
    { name: "Ouargla", code: "30", deliveryFast: 800.00, deliveryNormal: 500.00 },
    { name: "Tizi Ouzou", code: "15", deliveryFast: 800.00, deliveryNormal: 500.00 },
    { name: "Boumerdès", code: "35", deliveryFast: 800.00, deliveryNormal: 500.00 },
    { name: "Djelfa", code: "17", deliveryFast: 950.00, deliveryNormal: 600.00 },
    { name: "Biskra", code: "07", deliveryFast: 950.00, deliveryNormal: 600.00 },
    { name: "Tlemcen", code: "13", deliveryFast: 950.00, deliveryNormal: 600.00 },
    { name: "Mostaganem", code: "27", deliveryFast: 950.00, deliveryNormal: 600.00 },
    { name: "Mascara", code: "29", deliveryFast: 950.00, deliveryNormal: 600.00 },
    { name: "Tiaret", code: "14", deliveryFast: 950.00, deliveryNormal: 600.00 },
    { name: "Saïda", code: "20", deliveryFast: 950.00, deliveryNormal: 600.00 },
    { name: "Bechar", code: "08", deliveryFast: 1300.00, deliveryNormal: 800.00 },
    { name: "Adrar", code: "01", deliveryFast: 1500.00, deliveryNormal: 1000.00 },
    { name: "Tamenrasset", code: "11", deliveryFast: 2000.00, deliveryNormal: 1500.00 }
];

// Get all wilayas
app.get('/api/wilayas', (req, res) => {
    res.json(wilayas);
});

// Calculate delivery cost
app.post('/api/calculate-delivery', (req, res) => {
    try {
        const { wilayaCode, deliveryType = 'normal' } = req.body;
        const wilaya = wilayas.find(w => w.code === String(wilayaCode));
        
        if (!wilaya) {
            return res.status(404).json({ error: 'Wilaya not found' });
        }
        
        const cost = deliveryType === 'fast' ? wilaya.deliveryFast : wilaya.deliveryNormal;
        
        if (cost === "/") {
            return res.json({ available: false, message: 'Service not available for this wilaya' });
        }
        
        res.json({ 
            available: true,
            cost: cost,
            wilaya: wilaya.name
        });
    } catch (error) {
        console.error('Error calculating delivery:', error);
        res.status(500).json({ error: error.message });
    }
});

// Test image upload endpoint
app.post('/api/test-upload', upload.single('image'), (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }
        
        res.json({ 
            success: true, 
            filename: req.file.filename,
            path: `/uploads/${req.file.filename}`,
            fullUrl: `http://localhost:3040/uploads/${req.file.filename}`
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// List uploaded files
app.get('/api/uploads', (req, res) => {
    try {
        const files = fs.readdirSync(uploadsDir);
        const fileUrls = files.map(file => ({
            filename: file,
            url: `http://localhost:3040/uploads/${file}`,
            size: fs.statSync(path.join(uploadsDir, file)).size
        }));
        res.json(fileUrls);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Server status endpoint
app.get('/api/status', (req, res) => {
    const dbState = mongoose.connection.readyState;
    const dbStatus = {
        0: 'disconnected',
        1: 'connected',
        2: 'connecting',
        3: 'disconnecting'
    };
    
    // Check if uploads directory is accessible
    let uploadsWritable = false;
    try {
        fs.accessSync(uploadsDir, fs.constants.W_OK);
        uploadsWritable = true;
    } catch (e) {
        uploadsWritable = false;
    }
    
    res.json({
        server: 'running',
        port: 3040,
        database: {
            status: dbStatus[dbState] || 'unknown',
            connected: dbState === 1
        },
        uploads: {
            directory: uploadsDir,
            exists: fs.existsSync(uploadsDir),
            writable: uploadsWritable,
            files: fs.readdirSync(uploadsDir).length
        },
        timestamp: new Date().toISOString()
    });
});

// ========== Error Handling Middleware ==========
app.use((err, req, res, next) => {
    console.error('Server error:', err);
    res.status(500).json({ error: err.message });
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({ error: 'Endpoint not found' });
});
// أضف هذا بعد تعريف المسارات الأخرى

// Serve product.html for product pages

// ========== Start Server ==========
const PORT = 3040;

app.listen(PORT, () => {
    console.log('\n=================================');
    console.log('🚀 La Qualité Balloon Server');
    console.log('=================================');
    console.log(`📍 Server running on: http://localhost:${PORT}`);
    console.log(`👤 Seller: http://localhost:${PORT}/seller.html`);
    console.log(`🛒 Buyer: http://localhost:${PORT}/buyer.html`);
    console.log(`📁 Uploads directory: ${uploadsDir}`);
    console.log(`🔍 Status: http://localhost:${PORT}/api/status`);
    console.log(`📸 Test upload: http://localhost:${PORT}/api/uploads`);
    console.log('=================================\n');
});