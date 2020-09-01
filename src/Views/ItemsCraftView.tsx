import React from 'react';
import '../css/CraftView.css'
import ItemStack from '../Game/ItemStack';

interface IItemsCraftProps {
    itemStacks: ItemStack[];
    craftDuration: number;
}

export default class ItemsCraftView extends React.Component<IItemsCraftProps> {

    renderItemStack(itemStack: ItemStack) {
        var rate = itemStack.quantity / this.props.craftDuration * 1000;
        return (
            <div key={itemStack.id} className="item">
                <div>{itemStack.quantity} {itemStack.item.name}</div>
                <div>{rate.toFixed(2)}/s</div>
            </div>
        );
    }

    render() {
        return (
            <div className="item-list">
                {this.props.itemStacks.map((itemStack) => this.renderItemStack(itemStack))}
            </div>
        );
    }
}