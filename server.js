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
app.use(express.static(__dirname));
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

// Blocked Customer Schema
const blockedCustomerSchema = new mongoose.Schema({
    phone: { type: String, required: true, unique: true },
    name: String,
    reason: String,
    blockedAt: { type: Date, default: Date.now },
    unblockedAt: Date,
    isActive: { type: Boolean, default: true },
    previousOrders: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Order' }]
});

// Product Schema
const productSchema = new mongoose.Schema({
    name: { type: String, required: true },
    description: String,
    basePrice: { type: Number, required: true },
    mainImage: { type: String, default: 'default.jpg' },
    additionalImages: [{ type: String }],
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
        images: [{ type: String }]
    }],
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
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
        enum: ['قيد المراجعة', 'تم التأكيد', 'تم الشحن', 'تم التسليم', 'ملغي', 'معاد', 'محذوف'],
        default: 'قيد المراجعة'
    },
    notes: String,
    returnReason: String,
    isDeleted: { type: Boolean, default: false },
    deletedAt: Date,
    restoreAt: Date,
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});

// Seller Schema
const sellerSchema = new mongoose.Schema({
    username: { type: String, default: 'admin' },
    password: { type: String, default: '123456' }
});

const Product = mongoose.model('Product', productSchema);
const Order = mongoose.model('Order', orderSchema);
const Seller = mongoose.model('Seller', sellerSchema);
const BlockedCustomer = mongoose.model('BlockedCustomer', blockedCustomerSchema);

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
    limits: { fileSize: 10 * 1024 * 1024 },
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

// Get product by ID
app.get('/product/:id', (req, res) => {
    res.sendFile(path.join(__dirname, 'product.html'));
});

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
            
        if (prod.additionalImages) {
            prod.additionalImageUrls = prod.additionalImages.map(img => 
                `http://localhost:3040/uploads/${img}`
            );
        }
        
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

// Root endpoint
app.get('/', (req, res) => {
    res.redirect('/buyer.html');
});

app.get('/favicon.ico', (req, res) => {
    res.sendFile(path.join(__dirname, 'laqualite.png'));
});

app.get('/seller.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'seller.html'));
});

app.get('/buyer.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'buyer.html'));
});

// ========== BLOCKED CUSTOMERS ROUTES ==========

// Check if customer is blocked
app.post('/api/check-blocked', async (req, res) => {
    try {
        const { phone } = req.body;
        const blocked = await BlockedCustomer.findOne({ phone, isActive: true });
        
        if (blocked) {
            res.json({ 
                isBlocked: true, 
                reason: blocked.reason,
                blockedAt: blocked.blockedAt
            });
        } else {
            res.json({ isBlocked: false });
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Block a customer
app.post('/api/block-customer', async (req, res) => {
    try {
        const { phone, name, reason } = req.body;
        
        // Find previous orders from this phone
        const previousOrders = await Order.find({ 'customerInfo.phone': phone });
        
        let blocked = await BlockedCustomer.findOne({ phone });
        
        if (blocked) {
            blocked.reason = reason;
            blocked.name = name;
            blocked.isActive = true;
            blocked.unblockedAt = null;
            blocked.previousOrders = previousOrders.map(o => o._id);
            await blocked.save();
        } else {
            blocked = new BlockedCustomer({
                phone,
                name,
                reason,
                isActive: true,
                previousOrders: previousOrders.map(o => o._id)
            });
            await blocked.save();
        }
        
        res.json({ success: true, blocked });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Unblock a customer
app.post('/api/unblock-customer/:id', async (req, res) => {
    try {
        const blocked = await BlockedCustomer.findById(req.params.id);
        if (!blocked) {
            return res.status(404).json({ error: 'Not found' });
        }
        
        blocked.isActive = false;
        blocked.unblockedAt = new Date();
        await blocked.save();
        
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get all blocked customers
app.get('/api/blocked-customers', async (req, res) => {
    try {
        const blocked = await BlockedCustomer.find({ isActive: true }).sort({ blockedAt: -1 });
        res.json(blocked);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ========== ORDER ROUTES WITH SOFT DELETE ==========

// Move order to trash (soft delete)
app.post('/api/orders/:id/trash', async (req, res) => {
    try {
        const order = await Order.findByIdAndUpdate(
            req.params.id,
            { 
                isDeleted: true, 
                deletedAt: new Date(),
                status: 'محذوف'
            },
            { new: true }
        );
        
        if (!order) {
            return res.status(404).json({ error: 'Order not found' });
        }
        
        res.json({ success: true, order });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Restore order from trash
app.post('/api/orders/:id/restore', async (req, res) => {
    try {
        const order = await Order.findByIdAndUpdate(
            req.params.id,
            { 
                isDeleted: false, 
                restoreAt: new Date(),
                status: 'قيد المراجعة'
            },
            { new: true }
        );
        
        if (!order) {
            return res.status(404).json({ error: 'Order not found' });
        }
        
        res.json({ success: true, order });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Permanently delete order (for trash)
app.delete('/api/orders/:id/permanent', async (req, res) => {
    try {
        const order = await Order.findByIdAndDelete(req.params.id);
        
        if (!order) {
            return res.status(404).json({ error: 'Order not found' });
        }
        
        res.json({ success: true, message: 'Order permanently deleted' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get orders with filtering
app.get('/api/orders', async (req, res) => {
    try {
        const { status, showDeleted } = req.query;
        let query = {};
        
        // Filter by deleted status
        if (showDeleted === 'true') {
            query.isDeleted = true;
        } else {
            query.isDeleted = { $ne: true };
        }
        
        // Filter by status if provided
        if (status && status !== 'الكل') {
            if (status === 'المحذوفة') {
                query.isDeleted = true;
            } else {
                query.status = status;
            }
        }
        
        const orders = await Order.find(query).sort({ createdAt: -1 });
        res.json(orders);
    } catch (error) {
        console.error('Error fetching orders:', error);
        res.status(500).json({ error: error.message });
    }
});

// Update order details
app.put('/api/orders/:id', async (req, res) => {
    try {
        const orderData = req.body;
        orderData.updatedAt = new Date();
        
        const order = await Order.findByIdAndUpdate(
            req.params.id,
            orderData,
            { new: true }
        );
        
        if (!order) {
            return res.status(404).json({ error: 'Order not found' });
        }
        
        res.json({ success: true, order });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ========== PRODUCT ROUTES WITH UPDATE ==========

// Update product
app.put('/api/products/:id', upload.fields([
    { name: 'mainImage', maxCount: 1 },
    { name: 'additionalImages', maxCount: 20 },
    { name: 'colorImages', maxCount: 50 }
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
        }
        
        // Process additional images
        if (req.files && req.files['additionalImages']) {
            productData.additionalImages = req.files['additionalImages'].map(file => file.filename);
        }
        
        // Process color images
        if (req.files && req.files['colorImages'] && productData.colors) {
            const colorImageFiles = req.files['colorImages'];
            productData.colors = productData.colors.map((color, index) => {
                const colorImages = colorImageFiles
                    .filter(file => file.fieldname === `colorImages[${index}]`)
                    .map(file => file.filename);
                return { ...color, images: colorImages };
            });
        }
        
        productData.updatedAt = new Date();
        
        const product = await Product.findByIdAndUpdate(
            req.params.id,
            productData,
            { new: true }
        );
        
        if (!product) {
            return res.status(404).json({ error: 'Product not found' });
        }
        
        res.json({ success: true, product });
    } catch (error) {
        console.error('Error updating product:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get all products
app.get('/api/products', async (req, res) => {
    try {
        const products = await Product.find().sort({ createdAt: -1 });
        
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
        
        if (product.mainImage && product.mainImage !== 'default.jpg') {
            const imagePath = path.join(uploadsDir, product.mainImage);
            if (fs.existsSync(imagePath)) {
                fs.unlinkSync(imagePath);
            }
        }
        
        await Product.findByIdAndDelete(req.params.id);
        res.json({ success: true, message: 'Product deleted' });
    } catch (error) {
        console.error('Error deleting product:', error);
        res.status(500).json({ error: error.message });
    }
});

// Create new order with block check
// Create new order with block check - FIXED VERSION
// Create new order with block check - FIXED VERSION
app.post('/api/orders', async (req, res) => {
    try {
        const orderData = req.body;
        const phone = orderData.customerInfo?.phone;
        
        // Check if customer is blocked
        const blocked = await BlockedCustomer.findOne({ phone, isActive: true });
        if (blocked) {
            return res.status(403).json({ 
                error: 'customer_blocked',
                reason: blocked.reason,
                message: 'هذا الرقم محظور: ' + blocked.reason
            });
        }
        
        // Generate a unique order number
        let isUnique = false;
        let orderNumber;
        let attempts = 0;
        const maxAttempts = 10;
        
        while (!isUnique && attempts < maxAttempts) {
            // Generate a 6-digit order number
            orderNumber = Math.floor(100000 + Math.random() * 900000).toString();
            const existingOrder = await Order.findOne({ orderNumber });
            if (!existingOrder) {
                isUnique = true;
            }
            attempts++;
        }
        
        if (!isUnique) {
            throw new Error('Could not generate unique order number after multiple attempts');
        }
        
        // Create order object with explicit orderNumber
        const newOrder = new Order({
            ...orderData,
            orderNumber: orderNumber // Explicitly set the order number
        });
        
        // Save the order
        const savedOrder = await newOrder.save();
        
        // Send success response
        res.status(201).json({ 
            success: true, 
            orderNumber: savedOrder.orderNumber,
            message: 'Order created successfully' 
        });
        
    } catch (error) {
        console.error('Error creating order:', error);
        
        // Check for duplicate key error
        if (error.code === 11000) {
            return res.status(500).json({ 
                error: 'duplicate_order_number',
                message: 'حدث خطأ في إنشاء رقم الطلب، يرجى المحاولة مرة أخرى'
            });
        }
        
        res.status(500).json({ error: error.message });
    }
});
// Track order by number
app.get('/api/orders/track/:orderNumber', async (req, res) => {
    try {
        const order = await Order.findOne({ orderNumber: req.params.orderNumber, isDeleted: { $ne: true } });
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
    { name: 'additionalImages', maxCount: 20 },
    { name: 'colorImages', maxCount: 50 }
]), async (req, res) => {
    try {
        if (!req.body.productData) {
            return res.status(400).json({ error: 'Product data is required' });
        }
        
        const productData = JSON.parse(req.body.productData);
        
        if (req.files && req.files['mainImage'] && req.files['mainImage'][0]) {
            const mainImageFile = req.files['mainImage'][0];
            productData.mainImage = mainImageFile.filename;
        } else {
            productData.mainImage = 'default.jpg';
        }
        
        if (req.files && req.files['additionalImages']) {
            productData.additionalImages = req.files['additionalImages'].map(file => file.filename);
        } else {
            productData.additionalImages = [];
        }
        
        if (req.files && req.files['colorImages'] && productData.colors) {
            const colorImageFiles = req.files['colorImages'];
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

// Wilaya list with delivery prices
const wilayas = [
    { name: "Adrar", code: "01", deliveryFast: 1500.00, deliveryNormal: 1480.00 },
    { name: "Chlef", code: "02", deliveryFast: 950.00, deliveryNormal: 930.00 },
    { name: "Laghouat", code: "03", deliveryFast: 850.00, deliveryNormal: 830.00 },
    { name: "Oum El Bouagui", code: "04", deliveryFast: 850.00, deliveryNormal: 830.00 },
    { name: "Batna", code: "05", deliveryFast: 850.00, deliveryNormal: 830.00 },
    { name: "Bejaia", code: "06", deliveryFast: 900.00, deliveryNormal: 880.00 },
    { name: "Biskra", code: "07", deliveryFast: 950.00, deliveryNormal: 930.00 },
    { name: "Bechar", code: "08", deliveryFast: 1300.00, deliveryNormal: 1280.00 },
    { name: "Blida", code: "09", deliveryFast: 800.00, deliveryNormal: 780.00 },
    { name: "Bouira", code: "10", deliveryFast: 800.00, deliveryNormal: 780.00 },
    { name: "Tamanrasset", code: "11", deliveryFast: 2000.00, deliveryNormal: 1980.00 },
    { name: "Tebessa", code: "12", deliveryFast: 850.00, deliveryNormal: 830.00 },
    { name: "Tlemcen", code: "13", deliveryFast: 950.00, deliveryNormal: 930.00 },
    { name: "Tiaret", code: "14", deliveryFast: 950.00, deliveryNormal: 930.00 },
    { name: "Tizi Ouzou", code: "15", deliveryFast: 800.00, deliveryNormal: 780.00 },
    { name: "Alger", code: "16", deliveryFast: 800.00, deliveryNormal: 780.00 },
    { name: "Djelfa", code: "17", deliveryFast: 950.00, deliveryNormal: 930.00 },
    { name: "Jijel", code: "18", deliveryFast: 900.00, deliveryNormal: 880.00 },
    { name: "Setif", code: "19", deliveryFast: 850.00, deliveryNormal: 830.00 },
    { name: "Saïda", code: "20", deliveryFast: 950.00, deliveryNormal: 930.00 },
    { name: "Skikda", code: "21", deliveryFast: 900.00, deliveryNormal: 880.00 },
    { name: "Sidi Bel Abbes", code: "22", deliveryFast: 950.00, deliveryNormal: 930.00 },
    { name: "Annaba", code: "23", deliveryFast: 800.00, deliveryNormal: 780.00 },
    { name: "Guelma", code: "24", deliveryFast: 900.00, deliveryNormal: 880.00 },
    { name: "Constantine", code: "25", deliveryFast: 900.00, deliveryNormal: 880.00 },
    { name: "Médéa", code: "26", deliveryFast: 800.00, deliveryNormal: 780.00 },
    { name: "Mostaganem", code: "27", deliveryFast: 950.00, deliveryNormal: 930.00 },
    { name: "M'Sila", code: "28", deliveryFast: 850.00, deliveryNormal: 830.00 },
    { name: "Mascara", code: "29", deliveryFast: 950.00, deliveryNormal: 930.00 },
    { name: "Ouargla", code: "30", deliveryFast: 800.00, deliveryNormal: 780.00 },
    { name: "Oran", code: "31", deliveryFast: 800.00, deliveryNormal: 780.00 },
    { name: "El Bayadh", code: "32", deliveryFast: 1000.00, deliveryNormal: 980.00 },
    { name: "Illizi", code: "33", deliveryFast: 1900.00, deliveryNormal: 1880.00 },
    { name: "Bordj Bou Arreridj", code: "34", deliveryFast: 850.00, deliveryNormal: 830.00 },
    { name: "Boumerdès", code: "35", deliveryFast: 800.00, deliveryNormal: 780.00 },
    { name: "El Tarf", code: "36", deliveryFast: 950.00, deliveryNormal: 930.00 },
    { name: "Tindouf", code: "37", deliveryFast: 1750.00, deliveryNormal: 1730.00 },
    { name: "Tissemsilt", code: "38", deliveryFast: 950.00, deliveryNormal: 930.00 },
    { name: "El Oued", code: "39", deliveryFast: 800.00, deliveryNormal: 780.00 },
    { name: "Khenchela", code: "40", deliveryFast: 850.00, deliveryNormal: 830.00 },
    { name: "Souk Ahrass", code: "41", deliveryFast: 900.00, deliveryNormal: 880.00 },
    { name: "Tipaza", code: "42", deliveryFast: 800.00, deliveryNormal: 780.00 },
    { name: "Mila", code: "43", deliveryFast: 900.00, deliveryNormal: 880.00 },
    { name: "Ain Defla", code: "44", deliveryFast: 950.00, deliveryNormal: 930.00 },
    { name: "Naama", code: "45", deliveryFast: 1100.00, deliveryNormal: 1080.00 },
    { name: "Ain Temouchent", code: "46", deliveryFast: 950.00, deliveryNormal: 930.00 },
    { name: "Ghardaïa", code: "47", deliveryFast: 950.00, deliveryNormal: 930.00 },
    { name: "Relizane", code: "48", deliveryFast: 950.00, deliveryNormal: 930.00 },
    { name: "El M'Ghair", code: "49", deliveryFast: 850.00, deliveryNormal: 830.00 },
    { name: "Timimoun", code: "50", deliveryFast: 1200.00, deliveryNormal: 1180.00 },
    { name: "Ouled Djellal", code: "51", deliveryFast: 950.00, deliveryNormal: 930.00 },
    { name: "Béni Abbès", code: "52", deliveryFast: 1450.00, deliveryNormal: 1430.00 },
    { name: "In Salah", code: "53", deliveryFast: 1700.00, deliveryNormal: 1680.00 },
    { name: "In Guezzam", code: "54", deliveryFast: 2000.00, deliveryNormal: 1980.00 },
    { name: "Touggourt", code: "55", deliveryFast: 650.00, deliveryNormal: 630.00 },
    { name: "Djanet", code: "56", deliveryFast: 2200.00, deliveryNormal: 2180.00 },
    { name: "El Meniaa", code: "57", deliveryFast: 1000.00, deliveryNormal: 980.00 },
    { name: "Bordj Badji Mokhtar", code: "58", deliveryFast: 2000.00, deliveryNormal: 1980.00 }
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
    console.log(`🚫 Blocked customers API: /api/blocked-customers`);
    console.log('=================================\n');
});